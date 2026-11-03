# Verificación

| Fase | Comando | Requiere |
|---|---|---|
| Unitarias | `pnpm test` y `pnpm test:cc` | Nada |
| Integración | `pnpm test:int` | MySQL y dump real (o, solo para `eventos`, el origen sintético) |
| F5 | `EXPERIMENT_STRATEGY=A pnpm test:fabric` (también `B` y `BD`) | Red Fabric |

## Origen sintético

Para trabajar sin el dump: `mysql … investigacion_peruschool < tests/soporte/origen-sintetico.sql`. Sus conteos son otros, así que `pnpm db:verify` y `academico.test.ts` no aplican, y nada de lo medido con él vale como resultado.

## F6 y F7

| Prueba | Comando |
|---|---|
| Interrupción entre MySQL y el ledger | `EXPERIMENT_STRATEGY=B pnpm prueba:interrupcion` (también `A` y `BD`) |
| Revocación, supresión y consistencia | `EXPERIMENT_STRATEGY=B pnpm test:fabric` (también `A` y `BD`) |
| Conciliación manual | `pnpm reconcile --antiguedad=60` |
| Datos prohibidos | `pnpm privacidad:auditar` |

## Pruebas obligatorias (sección 6 del plan)

| # | Prueba | Dónde |
|---|---|---|
| 1 | Importación coincide | `pnpm db:verify` (exige el dump real) |
| 2 | Registro y consulta en A y B | `tests/fabric/estrategias.test.ts` |
| 3 | Alteración detectada | `tests/fabric/estrategias.test.ts` |
| 4 | Secuencia de versiones | `tests/integration/eventos.test.ts` |
| 5 | Reintento y versión vieja | `tests/fabric/privacidad.test.ts` |
| 6 | Interrupción | `pnpm prueba:interrupcion` |
| 7 | Revocación frente a supresión | `tests/fabric/privacidad.test.ts` |
| 8 | Cero datos prohibidos | `pnpm privacidad:auditar`; repetir con `--nombres` y con los CSV reales |
| 9 | El origen no cambia | Huella en `tests/soporte/servidor.ts` y `privacidad.test.ts` |

## F8 y F9

- **Interfaz:** recorrido completo en navegador (acceso, datos, académico, crear, rectificar, verificar, suprimir, experimentos, ancho de teléfono) contra la red real.
- **Benchmark:** `pnpm bench` probado de punta a punta con corridas cortas de humo. Esas corridas validan las herramientas y no son resultados.
- **Sin probar:** `benchmarks/jmeter/eventos.jmx`, la captura de `docker stats` y el tamaño del ledger con contenedores.
