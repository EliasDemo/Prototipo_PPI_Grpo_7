# Plan de desarrollo — Prototipo PPI Grupo 7

**Proyecto:** Arquitectura híbrida blockchain para trazabilidad microcurricular escalable: evaluación del rendimiento y de mecanismos asociados al derecho de supresión del GDPR
**Caso:** Colegio Nuevo Horizonte, Juliaca, Perú
**Equipo:** Julmer Quispe Apaza · Abdul Quispe Condori · Franck Coaquira Justo
**Asesor:** Dr. Esteban Tocto Cano
**Versión del plan:** 2.0, 27/10/2026. Reemplaza a `PLAN (10).md`.
**Entorno de trabajo:** Visual Studio Code con WSL2 y Docker

---

## 0. Cómo usar este documento

- El trabajo se ordena en **fases**. Una fase no se cierra hasta cumplir su **criterio de cierre**.
- Cada tarea tiene una casilla `[ ]`. Al terminarla se marca `[x]` y se hace un commit que mencione la tarea, por ejemplo `F2.3: consulta paginada de asistencias`.
- Las decisiones nuevas se registran en `docs/decisiones.md` con el formato ADR (contexto, decisión, consecuencias).
- No se inventan resultados. Si algo no se pudo medir, se reporta como limitación.

---

## 1. Decisiones tecnológicas cerradas

| Tema | Decisión | Motivo |
|---|---|---|
| Base relacional | **MySQL 8.4 LTS (InnoDB)** | El conjunto de datos ya está en MySQL (`investigacion_mysql.sql`). Así se evita una migración y los riesgos de cambiar tipos o colaciones. `mysql2/promise` está maduro. |
| Blockchain | **Hyperledger Fabric 2.5 LTS** | Es una red permisionada, con identidades X.509 y sin criptomoneda, y tiene benchmark oficial con Caliper. |
| Chaincode | JavaScript (`fabric-contract-api`) | Usa el mismo lenguaje que el resto del equipo. |
| Cliente Fabric | `@hyperledger/fabric-gateway` (gRPC) | Es la API recomendada desde Fabric 2.4. |
| Aplicación | **Next.js 16** con App Router, TypeScript estricto y Route Handlers en runtime Node.js | Mantiene el monolito modular que ya existe. |
| Validación | `zod` | Sirve para los contratos de la API y la configuración. |
| Pruebas | `vitest` para pruebas unitarias e integración, y `playwright` para e2e (opcional) | |
| Benchmark | Hyperledger Caliper 0.6 con un conector HTTP propio, y JMeter aparte | Caliper mide TPS confirmados, latencia de envío a confirmación y éxito. JMeter mide la latencia de extremo a extremo de la API (ADR-015). |
| Gestor de paquetes | `pnpm` | Ya está fijado en el repositorio. |
| Node.js | 22 LTS (en `.node-version`) | |

### Decisión pendiente que este plan cierra: dónde se ejecuta todo

**Todo el desarrollo se hace dentro de WSL2 (Ubuntu)** usando VS Code con la extensión *WSL*. Es decir, el repositorio se mueve a `~/investigacion-blockchain`, dentro del sistema de archivos de Linux, y no queda en `C:\Users\...`.

Esto evita problemas de rutas de certificados de Fabric entre Windows y Linux, puertos cruzados y la lentitud de I/O sobre `/mnt/c`. Fabric, MySQL (en Docker), Next.js y Caliper quedan en el mismo sistema.

### Ajustes a los documentos académicos (fuera del código)

- [ ] **PPI:** reemplazar las 21 menciones a PostgreSQL por MySQL 8.4 y justificar la elección con el argumento de la tabla anterior.
- [ ] **PPI:** revisar las fechas. Los datos cubren 2024–2026 y las notas solo existen para 2026.
- [ ] **Short paper:** nombrar explícitamente Hyperledger Fabric 2.5 como el *permissioned ledger*, mantener Besu solo como trabajo relacionado y declarar la cobertura real del conjunto de datos.
- [ ] Ambos documentos: indicar que la granularidad es bimestral para notas y diaria para asistencias, y que no hay evaluaciones individuales. Esto va como limitación.

---

## 2. Datos del proyecto

| Información | Cantidad | Uso en el prototipo |
|---|---|---|
| Estudiantes (seudónimos) | 552 | Relacionar los registros |
| Matrículas anuales | 1.100 (2024–2026) | Contexto y consultas |
| Secciones-año | 57 | Organización y filtros |
| Asistencias | 142.882 (2024–2026) | Carga experimental 2 |
| Notas registradas | 11.419 (2026, `registrada = 1`) | Carga experimental 1 |
| Celdas de notas | 24.676, incluidos guiones y vacíos | Preservar la cobertura |
| Catálogo | 37 asignaturas, 336 ofertas, 4 periodos | Contexto |
| Fuentes | 62 archivos | Procedencia |

**Tablas de origen** (base `investigacion_peruschool`): `ciclos`, `estudiantes`, `secciones`, `asignaturas`, `periodos`, `ofertas`, `fuentes`, `matriculas`, `asistencias`, `calificaciones`, `controles`.

**Reglas de datos:**
1. La base de origen es **solo lectura** para la aplicación, con un usuario limitado a `SELECT`.
2. `correspondencia_privada_mysql.sql` (tablas `identidades` e `historial_nombres`) **nunca** entra al repositorio, a Docker ni a las pruebas.
3. Ningún nombre, código institucional ni identificador original llega a Fabric ni a los CSV de resultados.
4. Los guiones y vacíos conservan su significado. No se completan datos artificialmente.
5. Las 5 diferencias entre subtotales de asistencia y celdas visibles se documentan en `docs/datos.md`.

---

## 3. Arquitectura objetivo

```text
 Navegador (operador)          Caliper (conector HTTP, token propio)
          │                                  │
          └──────────────┬───────────────────┘
                         ▼
        Next.js 16 ─ Route Handlers /api/v1 (Node.js)
                         │
                Casos de uso (src/modules)
                         │
     ┌───────── StorageStrategy (A | B) ─────────┐
     ▼                                            ▼
 MySQL 8.4                                  Fabric 2.5
 ├─ investigacion_peruschool (RO)           ├─ Org1 peer0
 └─ investigacion_experimental (RW)         ├─ Org2 peer0
    eventos, versiones, claves,             ├─ orderer (Raft)
    operaciones, mediciones                 └─ chaincode `trazabilidad`
```

**Dirección de dependencias:** `app → modules → server`. La UI nunca importa nada de `src/server/*` directamente.

### Estrategias de almacenamiento

| | A: Referencia | B: Híbrida |
|---|---|---|
| Detalle del evento | En Fabric, completo | En MySQL (`evento_detalle`) |
| En Fabric | Evento completo | `evidenciaId`, `prevId`, operación, versión, fecha experimental y HMAC |
| Clave HMAC | No aplica | Aleatoria por evento, guardada en `evento_clave` |
| Supresión | No es posible: solo revocación | Se borra el detalle y la clave, y la evidencia queda como "detalle retirado" |

Ambas estrategias implementan la misma interfaz:

```ts
interface StorageStrategy {
  registrar(evento: EventoNuevo, versionEsperada: number): Promise<Confirmacion>;
  obtener(eventoId: string): Promise<EventoConEvidencia>;
  verificar(eventoId: string): Promise<ResultadoVerificacion>; // OK | ALTERADO | DETALLE_RETIRADO | SIN_EVIDENCIA
  revocar(eventoId: string, motivo: string): Promise<Confirmacion>;
  suprimir?(registroId: string): Promise<ResultadoSupresion>;  // solo B
}
```

---

## 4. Preparación de Visual Studio Code

### Extensiones

| Extensión | Para qué |
|---|---|
| WSL (Microsoft) | Abrir el proyecto dentro de Ubuntu |
| Docker / Container Tools | Ver los contenedores de MySQL y Fabric |
| ESLint y Prettier | Estilo de código |
| Tailwind CSS IntelliSense | Interfaz |
| MySQL o SQLTools con el driver MySQL | Explorar las bases |
| Vitest | Ejecutar las pruebas desde el editor |
| REST Client o Thunder Client | Probar la API (`tests/http/*.http`) |
| Markdown All in One | Documentación |
| GitLens | Historial del equipo |

### Archivos de configuración del espacio de trabajo

- `.vscode/settings.json`: formateo al guardar, `typescript.tsdk` del proyecto y exclusión de `node_modules` y `.next`.
- `.vscode/extensions.json`: las extensiones recomendadas de la tabla anterior.
- `.vscode/launch.json`: depuración de Next.js (server-side) y de vitest.
- `.vscode/tasks.json`: tareas `db:up`, `fabric:up`, `dev`, `test` y `reconcile`.

### Scripts de `package.json` previstos

```jsonc
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:int": "vitest run tests/integration",
  "db:up": "docker compose -f infra/mysql/compose.yaml up -d",
  "db:import": "bash scripts/data/importar-origen.sh",
  "db:verify": "tsx scripts/data/verificar-origen.ts",
  "db:migrate": "tsx scripts/data/migrar-experimental.ts",
  "db:reset-exp": "tsx scripts/data/reset-experimental.ts",
  "fabric:up": "bash infra/fabric/network/up.sh",
  "fabric:down": "bash infra/fabric/network/down.sh",
  "cc:deploy": "bash infra/fabric/network/deploy-cc.sh",
  "reconcile": "tsx scripts/reconciliation/conciliar.ts",
  "bench": "bash benchmarks/caliper/run.sh"
}
```

---

## 5. Fases de desarrollo

Resumen:

| Fase | Nombre | Resultado principal | Depende de |
|---|---|---|---|
| F0 | Entorno | WSL2, Docker y VS Code listos; repositorio en Linux | — |
| F1 | Base de datos | Origen importado y verificado; base experimental migrada | F0 |
| F2 | Backend académico | API de consulta con paginación y filtros | F1 |
| F3 | Modelo de eventos | Eventos, versiones y operaciones en MySQL, sin Fabric todavía | F2 |
| F4 | Red Fabric y chaincode | Red de 2 organizaciones y chaincode desplegado y probado | F0 |
| F5 | Estrategias A/B | Registro, rectificación y verificación en ambos modos | F3 y F4 |
| F6 | Consistencia | Idempotencia, control de versiones y conciliación | F5 |
| F7 | Revocación y supresión | Diferencia demostrable entre A y B | F6 |
| F8 | Interfaz mínima | Las 5 vistas | F2, F5 y F7 |
| F9 | Benchmark | Conector de Caliper, piloto y 180 corridas | F6 |
| F10 | Cierre | Análisis, documentación y demo | F7, F8 y F9 |

F4 puede avanzar en paralelo con F2 y F3. Por ejemplo, una persona trabaja en Fabric mientras otra hace la API.

---

### F0: Entorno

**Objetivo:** que cualquier integrante del equipo pueda clonar el repositorio y levantar todo con los mismos comandos.

- [ ] F0.1 Instalar WSL2 con Ubuntu 24.04 y asignar recursos fijos en `.wslconfig` (por ejemplo, 8 GB de RAM y 4 CPU). Anotarlos, porque son parámetros del experimento.
- [ ] F0.2 Instalar Docker Desktop con el backend WSL2.
- [ ] F0.3 Instalar Node 22 con `nvm` o `fnm` y pnpm con `corepack enable`, ambos dentro de WSL.
- [ ] F0.4 Mover el repositorio a `~/investigacion-blockchain` y abrirlo con `code .` desde WSL.
- [ ] F0.5 Crear la configuración en `.vscode/` (sección 4).
- [ ] F0.6 Inicializar git y un remoto privado. Revisar el `.gitignore`: `data/`, `artifacts/`, `.env*` salvo `.env.example`, `wallet/` y `crypto-config/`.
- [ ] F0.7 Agregar las dependencias base: `mysql2`, `zod`, `@hyperledger/fabric-gateway`, `@grpc/grpc-js`, `vitest` y `tsx`.
- [ ] F0.8 Crear `src/server/config/env.ts`, que valida las variables con zod al arrancar.
- [ ] F0.9 Escribir los documentos que faltan: `docs/entorno.md`, `docs/modulos.md`, `docs/datos.md`, `docs/decisiones.md` y `docs/verificacion.md`.

**Cierre:** `pnpm lint && pnpm typecheck && pnpm build` pasa dentro de WSL, y `docker run hello-world` funciona.

---

### F1: Base de datos

**Objetivo:** tener el origen intacto y verificable, y una base experimental separada.

- [ ] F1.1 Crear `infra/mysql/compose.yaml` con MySQL 8.4, un volumen persistente, `utf8mb4_unicode_ci` y puerto 3306 solo en localhost.
- [ ] F1.2 Escribir `scripts/data/importar-origen.sh`, que importa `data/source/investigacion_mysql.sql` con un usuario `prep`. La carpeta `data/source/` está ignorada por git.
- [ ] F1.3 Crear usuarios separados:
  - `app_ro`: `SELECT` sobre `investigacion_peruschool.*`
  - `app_exp`: `SELECT, INSERT, UPDATE, DELETE` sobre `investigacion_experimental.*`
- [ ] F1.4 Escribir `scripts/data/verificar-origen.ts`, que comprueba los conteos de la sección 2, las claves foráneas sin huérfanos, `registrada = 1` igual a 11.419 y la ausencia de las tablas `identidades` e `historial_nombres`. Guarda un reporte en JSON con el hash SHA-256 del dump.
- [ ] F1.5 Crear las migraciones de la base experimental en `database/experimental/migrations/`:

| Tabla | Contenido clave |
|---|---|
| `registro` | `registro_id` (UUID), tipo (`NOTA` o `ASISTENCIA`), `origen_ref`, `estado_vigencia`, `version_actual` |
| `evento` | `evento_id` (UUID), `registro_id`, versión, operación (`CREAR`, `RECTIFICAR`, `REVOCAR` o `SUPRIMIR`), `prev_evento_id`, actor, motivo y fecha experimental |
| `evento_detalle` | `evento_id` y `payload` JSON. En modo A es temporal |
| `evento_clave` | `evento_id` y `hmac_key` (32 bytes). Solo existe en modo B |
| `operacion` | `op_id`, `evento_id`, estado (`PENDIENTE`, `ENVIADA`, `CONFIRMADA`, `FALLIDA` o `TARDIA`), intentos, `tx_id`, timestamps y error |
| `experimento` | Configuración inmutable con su hash |
| `corrida` | Estrategia, carga, TPS, workers, repetición, inicio y fin |
| `medicion` | Por operación: `t_mysql_ms`, `t_fabric_submit_ms`, `t_fabric_commit_ms`, `t_total_ms` y resultado |

  Restricciones: `UNIQUE(registro_id, version)` y `UNIQUE(evento_id)`.
- [ ] F1.6 Escribir `scripts/data/reset-experimental.ts`, que trunca la base experimental sin tocar la de origen.

**Cierre:** `pnpm db:verify` reporta todos los conteos correctos, y un `INSERT` con `app_ro` falla como se espera.

---

### F2: Backend académico (consulta)

**Objetivo:** leer el origen mediante la API.

Estructura de cada módulo:

```text
src/modules/academico/
  esquemas.ts        # zod: filtros y respuestas
  consultas.ts       # casos de uso
  repositorio.ts     # SQL parametrizado (usa server/mysql)
```

- [ ] F2.1 Crear `src/server/mysql/pool.ts` con dos pools (`ro` y `exp`), un helper `query<T>()` y un timeout.
- [ ] F2.2 Crear la respuesta estándar de la API y el manejo de errores: `{ data, meta: { page, pageSize, total } }` y `{ error: { code, message } }`.
- [ ] F2.3 Escribir los endpoints:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/datos/resumen` | Conteos, años, fuentes y diferencias |
| GET | `/api/v1/academico/estudiantes` | Paginado; filtros `anio` y `seccion` |
| GET | `/api/v1/academico/estudiantes/:id` | Matrículas del estudiante |
| GET | `/api/v1/academico/calificaciones` | Filtros `anio`, `seccion`, `asignatura`, `periodo` y `registrada` |
| GET | `/api/v1/academico/asistencias` | Filtros `anio`, `seccion`, `desde` y `hasta` |
| GET | `/api/v1/academico/catalogo` | Asignaturas, ofertas, periodos y secciones |

- [ ] F2.4 Autenticación mínima (`src/modules/autenticacion`): un operador local con sesión en cookie firmada y un token Bearer separado para Caliper. Ambos se validan en un helper `requireAuth()`.
- [ ] F2.5 Pruebas de integración contra MySQL en Docker y un archivo `tests/http/academico.http`.

**Cierre:** todas las rutas responden paginadas, con un p95 menor a 300 ms en local para `pageSize = 50`, y los SQL tienen índices revisados con `EXPLAIN`.

---

### F3: Modelo de eventos (sin blockchain)

**Objetivo:** el ciclo completo de eventos en MySQL, con una estrategia simulada `NullLedger` para probar sin Fabric.

- [ ] F3.1 Definir los tipos `EventoAcademico` y `Evidencia` en `src/modules/eventos/tipos.ts`.
- [ ] F3.2 Escribir la serialización determinista versionada (`src/server/crypto/canonical.ts`): claves ordenadas, sin espacios, números normalizados y un campo `schemaVersion: 1`.
- [ ] F3.3 Escribir el HMAC-SHA256 con una clave aleatoria de 32 bytes por evento (`src/server/crypto/hmac.ts`).
- [ ] F3.4 Caso de uso "crear copia de ensayo": toma una nota o asistencia del origen, crea un `registro` con un UUID nuevo y un evento `CREAR` de versión 1.
- [ ] F3.5 Caso de uso "rectificar": recibe `versionEsperada`; si no coincide con `version_actual` responde 409. Crea un evento enlazado con `prev_evento_id`.
- [ ] F3.6 Endpoints:

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/eventos` | Crear copia (`Idempotency-Key` obligatorio) |
| POST | `/api/v1/eventos/:registroId/rectificaciones` | Body con `versionEsperada`, cambios y motivo |
| GET | `/api/v1/trazabilidad/:registroId` | Cadena de versiones |
| GET | `/api/v1/eventos/:eventoId` | Detalle, evidencia y estado |

**Cierre:** las pruebas unitarias de serialización y HMAC dan el mismo hash en dos ejecuciones, y la rectificación con una versión vieja devuelve 409.

---

### F4: Red Fabric y chaincode

**Objetivo:** una red reproducible y un contrato probado de forma aislada.

- [ ] F4.1 Descargar `fabric-samples` 2.5 con `install-fabric.sh` dentro de `infra/fabric/` y fijar las versiones de las imágenes.
- [ ] F4.2 Escribir los scripts `up.sh` y `down.sh` basados en `test-network`: 2 organizaciones, 1 peer por organización, un orderer Raft, el canal `trazabilidad` y CouchDB opcional (usar LevelDB por defecto, porque es más rápido para el benchmark).
- [ ] F4.3 Chaincode en `chaincode/src/trazabilidad.js`:

| Función | Comportamiento |
|---|---|
| `RegistrarEvidencia(json)` | Modo B. Solo admite `evidenciaId`, `registroOpacoId`, `prevEvidenciaId`, `version`, `operacion`, `hmac` y `schemaVersion`; rechaza cualquier campo extra |
| `RegistrarEventoCompleto(json)` | Modo A, con un evento **sintético**. Tamaño máximo configurable |
| `ObtenerEvidencia(id)` | Lectura |
| `HistorialRegistro(registroOpacoId)` | Por clave compuesta `registro~version` |
| `Revocar(id, motivoCodigo)` | Agrega un evento de revocación sin borrar nada. El motivo es un código, nunca texto libre |

  Reglas: si un ID ya existe con el mismo contenido, se devuelve lo existente (idempotente); si existe con otro contenido, es un error. Si `version > 1`, debe existir `prevEvidenciaId` con `version - 1` del mismo registro. La fecha es el timestamp de la transacción (`ctx.stub.getTxTimestamp()`), no la que manda el cliente. No se usan `Date.now()` ni `Math.random()`, para que el chaincode sea determinista entre peers.
- [ ] F4.4 Pruebas del chaincode en `chaincode/test` con `fabric-shim` simulado o con un stub.
- [ ] F4.5 Escribir `deploy-cc.sh` con la política de endorsement `AND(Org1.peer, Org2.peer)`. Debe ser **la misma para A y B**.
- [ ] F4.6 Crear perfiles de conexión e identidades en `infra/fabric/connection-profiles/`, ignorados por git. Las rutas se toman de `.env` (solo del servidor).

**Cierre:** desde la CLI de los peers se puede invocar y consultar el chaincode, y sus pruebas pasan.

---

### F5: Estrategias A/B integradas

- [x] F5.1 Crear `src/server/fabric/gateway.ts`: conexión única reutilizable, `submitAsync`, espera de `getStatus()` (commit válido) y timeouts configurables.
- [x] F5.2 Crear `src/server/storage-strategies/estrategia-a.ts`: guarda el detalle temporal en MySQL, lo envía completo a Fabric y, al confirmarse, borra el temporal. **En el modo A, lo que llega a Fabric es un evento SINTÉTICO no identificable**, con la misma estructura y el mismo tamaño que el real (ADR-015).
- [x] F5.3 Crear `src/server/storage-strategies/estrategia-b.ts`: guarda el detalle y la clave en MySQL, envía solo la evidencia con su HMAC y al confirmarse marca la operación.
- [x] F5.4 Crear `src/server/storage-strategies/index.ts`: elige la estrategia según `EXPERIMENT_STRATEGY`, que se fija al arrancar y no cambia durante una corrida.
- [x] F5.5 Escribir la verificación (`POST /api/v1/trazabilidad/:eventoId/verificar`):
  - B: recalcula el HMAC del detalle de MySQL y lo compara con Fabric (`OK`, `ALTERADO` o `DETALLE_RETIRADO`).
  - A: compara el contenido de Fabric consigo mismo y con su historial.
- [x] F5.6 Escribir una prueba que altere a propósito una fila de `evento_detalle` y compruebe que el resultado es `ALTERADO`.
- [x] F5.7 Instrumentar tiempos con `performance.now()` en cada etapa y guardarlos en `medicion`.

**Cierre:** el ciclo crear, rectificar y verificar funciona en A y en B con la red real.

---

### F6: Consistencia y recuperación

- [x] F6.1 **Bandeja transaccional (outbox)**: la operación se registra como `PENDIENTE` en la misma transacción de MySQL que el cambio académico; luego se ancla en Fabric, se espera el commit, y finalmente se marca `CONFIRMADA` en una transacción local. La profundidad de la bandeja (operaciones `PENDIENTE` o `ENVIADA`) es una métrica del experimento.
- [x] F6.2 Idempotencia: la misma `Idempotency-Key` devuelve el mismo `evento_id` y el mismo contenido. En Fabric, un ID repetido se considera "ya confirmado" y no un error.
- [x] F6.3 Reintentos con backoff exponencial y un máximo configurable.
- [x] F6.4 Escribir `scripts/reconciliation/conciliar.ts`: recorre las operaciones `PENDIENTE` o `ENVIADA` con más de N segundos, consulta Fabric y marca cada una como `CONFIRMADA`, `TARDIA` o `FALLIDA`.
- [x] F6.5 Prueba de interrupción: matar el proceso entre el envío y la confirmación, ejecutar `pnpm reconcile` y comprobar que el estado es consistente y sin duplicados.

**Cierre:** las pruebas de reintento, versión desactualizada e interrupción pasan.

---

### F7: Revocación y supresión

- [x] F7.1 `POST /api/v1/eventos/:registroId/revocaciones`: agrega un evento `REVOCAR` y cambia la vigencia, en ambos modos.
- [x] F7.2 `POST /api/v1/privacidad/:registroId/supresion`, solo en modo B:
  - Borra `evento_detalle` y `evento_clave` de **todas** las versiones del registro.
  - Elimina el vínculo `registro.origen_ref`.
  - Registra un evento `SUPRIMIR` en Fabric, sin datos personales.
  - Desde ese momento, verificar devuelve `DETALLE_RETIRADO`.
- [x] F7.3 En modo A, la misma solicitud responde 409 con `SUPRESION_NO_SOPORTADA`. Una prueba demuestra que el contenido sigue legible en Fabric después de revocar.
- [x] F7.4 Escribir `scripts/experiments/auditar-privacidad.ts`: busca en el ledger y en los CSV exportados patrones de nombres, códigos originales y claves. Debe reportar cero coincidencias.
- [x] F7.5 Documentar los límites: no hay eliminación de respaldos, logs de Docker ni archivos originales, y esto no certifica cumplimiento del GDPR.

**Cierre:** las 9 pruebas funcionales obligatorias (sección 6) pasan.

---

### F8: Interfaz mínima

Las rutas están en `src/app/(prototipo)/`. Solo consumen la API.

- [x] F8.1 `/acceso`: login del operador.
- [x] F8.2 `/datos`: cobertura, conteos, fuentes y diferencias.
- [x] F8.3 `/academico`: tablas con filtros y paginación.
- [x] F8.4 `/laboratorio`: crear copias, rectificar, revocar y suprimir.
- [x] F8.5 `/trazabilidad`: línea de versiones con su estado y el botón "verificar".
- [x] F8.6 `/experimentos`: lista de corridas y descarga de CSV y JSON.

**Cierre:** se puede hacer la demo completa sin usar la terminal.

---

### F9: Benchmark con Caliper y JMeter

> Alineado con el artículo presentado (ADR-015). Si hay diferencias con este plan, manda el artículo.

**Herramientas:**
- **Caliper**: mide los TPS confirmados, la latencia desde el envío hasta la confirmación en el ledger y la tasa de éxito.
- **JMeter**, en corridas separadas: mide la latencia de extremo a extremo de la API (`POST /api/v1/eventos`).

- [x] F9.1 Escribir el conector HTTP en `benchmarks/caliper/connectors/http`, que llama a `POST /api/v1/eventos` con el token de benchmark. Una operación solo se cuenta como éxito cuando la respuesta indica `CONFIRMADA`.
- [x] F9.2 Definir dos workloads: `notas-2026` y `asistencias-2026`. La selección de registros se hace con una semilla fija, en el mismo orden para A y B. En el modo A, Fabric recibe eventos sintéticos no identificables con la misma estructura y el mismo tamaño que los reales.
- [x] F9.3 Crear la matriz en `benchmarks/caliper/config/`:

| Parámetro | Valores |
|---|---|
| Estrategia | BD (línea base sin ledger), A y B, orden rotado en cada repetición (ADR-017) |
| Carga ofrecida (candidata) | 5, 10, 25 y 50 escrituras/s. **Las definitivas se fijan después del piloto** y el cambio se documenta en un ADR |
| Workers | Se fija en el piloto y se mantiene igual en todas las corridas |
| Calentamiento / observación | 60 s / 180 s |
| Repeticiones | 5 |
| Cargas de trabajo | notas, asistencias |
| **Total (candidato)** | 3 × 4 × 2 × 5 = **120 corridas**, unas 8 h de medición más la preparación |

- [x] F9.4 Escribir `run.sh` para cada corrida: ejecuta `db:reset-exp`, verifica que la red esté sana (`fabric:health`), corre Caliper, ejecuta la conciliación de hasta 90 s y exporta los resultados. El orden de A y B se alterna en cada pareja.
- [x] F9.5 Capturar recursos con `docker stats` y el CPU y la memoria del generador; la profundidad de la bandeja transaccional (outbox) durante la corrida; y el tamaño de la base experimental y del ledger antes y después.
- [ ] F9.6 Hacer primero un **piloto** (una combinación por estrategia) y fijar con él las cargas y los workers definitivos.
- [ ] F9.7 Plan de JMeter (`benchmarks/jmeter/`): las mismas cargas, en corridas separadas de las de Caliper.
- [x] F9.8 Guardar los resultados en `artifacts/results/<corrida>/` con `config.json` (incluye su hash y el commit de git), `caliper-report.html`, `mediciones.csv` y `recursos.csv`.

**Métricas:** media, p50 y p95 de la latencia; tasa de éxito; dispersión entre repeticiones; CPU y RAM; profundidad de la bandeja transaccional (outbox); tamaño del payload (bytes en el ledger y fuera de él). También se reportan los TPS ofrecidos, enviados y confirmados, y las tasas de error, timeout y confirmación tardía.

**Cierre:** todas las corridas de la matriz definitiva completas, cada una trazable a su configuración y commit.

---

### F10: Cierre del PPI

- [x] F10.1 Escribir el notebook o script de análisis en `scripts/experiments/analisis`: medianas por escenario a partir de las 5 repeticiones, sin tratar cada transacción como un experimento independiente.
- [x] F10.2 Generar los gráficos de latencia frente a TPS y de throughput confirmado por estrategia.
- [ ] F10.3 Escribir `artifacts/reports/informe-evaluacion.md`, incluyendo los resultados desfavorables y los límites.
- [ ] F10.4 Actualizar el PPI y el short paper con los resultados reales.
- [ ] F10.5 Escribir el guion de la demo y grabarla.
- [x] F10.6 Escribir el README final con la reproducción completa desde cero.

---

## 6. Pruebas funcionales obligatorias

| # | Prueba | Fase |
|---|---|---|
| 1 | La importación coincide con los conteos y relaciones | F1 |
| 2 | Registro y consulta en A y en B | F5 |
| 3 | Se detecta una alteración del detalle | F5 |
| 4 | La rectificación conserva la secuencia de versiones | F3 y F5 |
| 5 | Un reintento no duplica y una versión vieja recibe 409 | F6 |
| 6 | Recuperación después de una interrupción entre MySQL y Fabric | F6 |
| 7 | Diferencia observable entre revocación y supresión | F7 |
| 8 | Cero nombres, códigos o claves en el ledger y los CSV | F7 |
| 9 | La supresión no altera el origen | F7 |

---

## 7. Variables de entorno (`.env.example`)

```dotenv
# MySQL
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_RO_USER=app_ro
MYSQL_RO_PASSWORD=
MYSQL_EXP_USER=app_exp
MYSQL_EXP_PASSWORD=
MYSQL_DB_ORIGEN=investigacion_peruschool
MYSQL_DB_EXP=investigacion_experimental

# Fabric (rutas solo del servidor; nunca con NEXT_PUBLIC_)
FABRIC_PEER_ENDPOINT=localhost:7051
FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_MSP_ID=Org1MSP
FABRIC_CERT_PATH=
FABRIC_KEY_PATH=
FABRIC_TLS_CERT_PATH=
FABRIC_CHANNEL=trazabilidad
FABRIC_CHAINCODE=trazabilidad
FABRIC_COMMIT_TIMEOUT_MS=30000

# Experimento
EXPERIMENT_STRATEGY=B          # A | B
EXPERIMENT_SEED=20261027

# Autenticación
SESSION_SECRET=
OPERADOR_USUARIO=
OPERADOR_PASSWORD_HASH=
BENCH_TOKEN=
```

---

## 8. Reparto sugerido del equipo

| Integrante | Fases principales |
|---|---|
| Integrante 1 | F1, F2 y F8 (datos, API de consulta e interfaz) |
| Integrante 2 | F4 y F9 (Fabric, chaincode y Caliper) |
| Integrante 3 | F3, F5, F6 y F7 (eventos, estrategias, consistencia y privacidad) |
| Todos | F0, F10 y revisión cruzada de pull requests |

Flujo de git: una rama por tarea (`f2/consulta-asistencias`), un pull request a `main` con revisión de otra persona, y CI con lint, typecheck y pruebas unitarias.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fabric consume demasiados recursos en un solo equipo | Recursos fijos en `.wslconfig`, LevelDB y la misma máquina para A y B |
| 100 TPS satura la red | Se reporta como límite de capacidad, sin forzar los resultados |
| Filtración de datos reales | Correspondencia fuera del repositorio, auditoría F7.4 y `.gitignore` revisado |
| Diferencias entre Windows y WSL | Todo se ejecuta dentro de WSL (sección 1) |
| Desalineación entre documentos y código | Las tareas de ajuste de la sección 1 se hacen antes de F9 |
