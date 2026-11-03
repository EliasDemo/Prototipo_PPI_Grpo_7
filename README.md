# Prototipo PPI Grupo 7: trazabilidad de registros académicos

Arquitectura híbrida con Hyperledger Fabric 2.5, MySQL 8.4 y Next.js 16. Conserva las versiones académicas fuera de la cadena y ancla evidencias criptográficas en el ledger. Es un prototipo de investigación: no sustituye el sistema del colegio ni certifica que una nota sea verdadera. El plan está en `PLAN_DESARROLLO.md` y las decisiones, en `docs/decisiones.md`.

| Estrategia | En el ledger | Supresión |
|---|---|---|
| `BD` | Nada (línea base) | No |
| `A` | Evento completo, sintético | No, solo revocación |
| `B` | Identificadores opacos, rol y HMAC | Sí |

## Reproducir desde cero (WSL2 con Docker)

Requisitos: Node 22, pnpm, Docker y los binarios de Fabric (`infra/fabric/versiones.env`). El dump `investigacion_mysql.sql` es confidencial: pídelo al equipo y nunca lo subas al repositorio.

```bash
pnpm install
cp .env.example .env          # completa contraseñas y secretos; pnpm auth:hash genera el hash del operador
mkdir -p data/source && cp <ruta>/investigacion_mysql.sql data/source/
pnpm db:up && pnpm db:import && pnpm db:migrate && pnpm db:verify
pnpm fabric:up
pnpm build && pnpm start      # http://localhost:3000
```

## Pruebas

Ver `docs/verificacion.md`.

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:cc
pnpm test:int
EXPERIMENT_STRATEGY=B pnpm test:fabric        # también A y BD
EXPERIMENT_STRATEGY=B pnpm prueba:interrupcion
pnpm privacidad:auditar --nombres=<lista fuera del repositorio>
```

## Benchmark

```bash
pnpm bench --piloto    # fija cargas y workers; regístralos en un ADR y en benchmarks/caliper/config/matriz.env
pnpm bench             # matriz completa; unas 8 h de medición
pnpm analizar          # resultados en artifacts/reports
```

Los resultados quedan en `artifacts/`, ignorado por git. Revisa la auditoría de privacidad antes de compartirlos.

## Límites conocidos

- Una misma parte administra todas las organizaciones: hay separación lógica, no independencia.
- La supresión no alcanza respaldos ni logs (`docs/privacidad.md`).
- Difiere del artículo en base de datos, API, configuraciones, orderers y purga nativa: pendiente de decisión.
