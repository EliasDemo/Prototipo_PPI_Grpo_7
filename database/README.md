# Base de datos — Fase F1

Dos bases en un mismo MySQL 8.4 (Docker):

| Base | Contenido | Quién escribe | Quién lee |
|---|---|---|---|
| `investigacion_peruschool` | Origen seudonimizado (11 tablas) | Solo `prep`, una vez | `app_ro` |
| `investigacion_experimental` | Laboratorio: registros, eventos, claves, operaciones, mediciones | `app_exp` | `app_exp` |

La correspondencia privada (`identidades`, `historial_nombres`) **no se importa nunca**. El script de importación la rechaza.

## Archivos

```text
infra/mysql/
  compose.yaml                 # MySQL 8.4, puerto solo en 127.0.0.1, recursos fijos
  conf/my.cnf                  # utf8mb4, zona -05:00, InnoDB estable para benchmark
  init/01-usuarios.sh          # crea prep, app_ro, app_exp (solo en volumen vacío)
database/
  source/conteos-esperados.json        # verdad para la verificación
  experimental/migrations/
    001_esquema_experimental.sql       # tablas + triggers de inmutabilidad
    002_vistas.sql                     # vistas para UI y conciliación
scripts/data/
  _mysql.sh                    # helper común (carga .env, usa el contenedor)
  importar-origen.sh           # F1.2
  migrar-experimental.sh       # F1.5 (registra hash de cada migración)
  verificar-origen.ts          # F1.4 (25 comprobaciones)
  reset-experimental.sh        # F1.6
```

## Paso a paso (terminal de VS Code, dentro de WSL)

```bash
# 0. Dependencias
pnpm add mysql2
pnpm add -D tsx dotenv

# 1. Copiar el SQL de origen (carpeta ignorada por git)
mkdir -p data/source
cp /mnt/c/Users/ASUS/Downloads/investigacion_mysql.sql data/source/

# 2. Variables: copiar .env.example → .env y poner contraseñas
# 3. Levantar MySQL y esperar a "healthy"
pnpm db:up
docker ps            # STATUS: (healthy)

# 4. Importar, migrar y verificar
pnpm db:import       # ~10-30 s
pnpm db:migrate
pnpm db:verify       # debe terminar en 25/25
```

Antes de cada corrida del benchmark: `pnpm db:reset-exp --si`.

## Agregar a `.env.example`

```dotenv
MYSQL_ROOT_PASSWORD=
MYSQL_PREP_PASSWORD=
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_RO_USER=app_ro
MYSQL_RO_PASSWORD=
MYSQL_EXP_USER=app_exp
MYSQL_EXP_PASSWORD=
MYSQL_DB_ORIGEN=investigacion_peruschool
MYSQL_DB_EXP=investigacion_experimental
```

## Agregar a `package.json` → `scripts`

```json
"db:up": "docker compose -f infra/mysql/compose.yaml up -d",
"db:down": "docker compose -f infra/mysql/compose.yaml down",
"db:import": "bash scripts/data/importar-origen.sh",
"db:migrate": "bash scripts/data/migrar-experimental.sh",
"db:verify": "tsx scripts/data/verificar-origen.ts",
"db:reset-exp": "bash scripts/data/reset-experimental.sh"
```

> `pnpm db:down -v` borra también el volumen (todos los datos). Úselo solo para empezar de cero.

## Modelo experimental

```text
experimento 1─* corrida 1─* medicion
                   │  └─* muestra_recursos
                   │
registro 1─* evento ─┬─1 evento_detalle   (B: persistente · A: temporal)
   │          │ ↑prev ├─1 evento_clave     (solo B; borrar = desvincular)
   │          │       └─1 operacion        (PENDIENTE→ENVIADA→CONFIRMADA/FALLIDA/TARDIA)
   └─1 supresion (solo B)
```

Garantías en la propia base:

- `UNIQUE(registro_id, version)`: dos rectificaciones simultáneas no crean la misma versión.
- `UNIQUE(prev_evento_id)`: la cadena es lineal, sin bifurcaciones.
- `CHECK`: la versión 1 no tiene evento previo y las demás sí.
- `UNIQUE(idempotency_key)`: un reintento no duplica la operación.
- Trigger `trg_evento_append_only`: un evento solo puede cambiar su `estado_confirmacion`.
- Trigger `trg_experimento_inmutable`: una configuración de experimento no se edita.
- `ON DELETE CASCADE` de detalle y clave: la supresión borra ambos de todas las versiones.

## Migraciones nuevas

No se edita una migración ya aplicada, porque el script detecta el cambio por su hash. Para cambiar el esquema se crea `003_descripcion.sql`.
