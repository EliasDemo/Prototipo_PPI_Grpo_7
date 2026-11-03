# Verificación

| Fase | Comando | Requiere |
|---|---|---|
| Unitarias | `pnpm test` y `pnpm test:cc` | Nada |
| Integración | `pnpm test:int` | MySQL y dump real (o, solo para `eventos`, el origen sintético) |
| F5 | `EXPERIMENT_STRATEGY=A pnpm test:fabric` (también `B` y `BD`) | Red Fabric |

## Origen sintético

Para trabajar sin el dump: `mysql … investigacion_peruschool < tests/soporte/origen-sintetico.sql`. Sus conteos son otros, así que `pnpm db:verify` y `academico.test.ts` no aplican, y nada de lo medido con él vale como resultado.
