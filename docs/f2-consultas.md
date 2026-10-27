# F2 · Revisión de consultas (EXPLAIN) y latencia

Fecha: 27/10/2026. MySQL 8.4 en Docker (2 CPU, 3 GB, buffer pool 1 GB) dentro de WSL2.
Todas las consultas usan el pool `ro` (usuario `app_ro`) y parámetros `?`.

## EXPLAIN ANALYZE de los peores casos

| # | Consulta | Plan | Tiempo |
|---|---|---|---|
| Q1 | Estudiantes, sin filtro, página profunda | Paginación sobre la PK de `estudiantes` + lookup por `matriculas.estudiante_id` | 1,4 ms |
| Q2 | Estudiantes con `anio` + `seccion` (conteo) | Semi-join con índice `matriculas.seccion_id` | 0,6 ms |
| Q3 | Calificaciones sin filtro, offset 24.600 | **Antes:** filesort de 24.650 filas por el JOIN con `ofertas` (69 ms). **Ahora:** paginación diferida, recorrido cubierto de la PK + 50 lookups | 4,5 ms |
| Q4 | Calificaciones `registrada = 1` (conteo) | Recorrido completo de `calificaciones` (no hay índice en `registrada`) | 5 ms |
| Q5 | Calificaciones por sección | Índice `ofertas.seccion_id` → `calificaciones.oferta_id`, ordena unas 400 filas | 1,3 ms |
| Q6 | Asistencias sin filtro, última página | Paginación diferida sobre `idx_asistencia_fecha (anio, fecha)` + PK: sin filesort | 16 ms |
| Q7 | Asistencias `desde`/`hasta` **sin** `anio` | No se usa `idx_asistencia_fecha` (empieza por `anio`) → recorrido completo; el LIMIT lo detiene pronto | 1,7 ms (conteo) |
| Q8 | Asistencias por sección, última página | Índice `seccion_id` + filesort de unas 2.500 filas | 29 ms |

Decisiones tomadas **sin tocar el origen**:

- **Paginación diferida** en calificaciones y asistencias: primero se paginan solo las PK (en índice) y después se leen las filas completas y los JOIN.
- Orden estable de asistencias: `(anio, fecha, asistencia_id)`, que coincide con `idx_asistencia_fecha` más la PK implícita de InnoDB.
- Orden estable de calificaciones y estudiantes: por la PK.

## Latencia (pageSize = 50)

`pnpm latencia:api` con 200 solicitudes por ruta, páginas al azar con semilla fija (incluye las últimas) y build de producción (`next start`). El reporte completo queda en `artifacts/reports/latencia-api-f2.json`.

| Ruta | p95 con conc. 1 | p95 con conc. 4 | p99 con conc. 4 |
|---|---|---|---|
| datos/resumen | 29,9 | 179,5 | 184,7 |
| academico/catalogo | 5,9 | 14,9 | 17,9 |
| academico/estudiantes | 3,7 | 9,5 | 10,5 |
| academico/estudiantes?anio&seccion | 3,9 | 6,9 | 8,1 |
| academico/estudiantes/:id | 3,2 | 7,4 | 8,9 |
| academico/calificaciones | 5,5 | 16,3 | 27,2 |
| academico/calificaciones?registrada&periodo | 19,1 | 94,5 | 97,2 |
| academico/asistencias | 14,9 | 80,4 | 83,2 |
| academico/asistencias?anio&desde&hasta | 17,2 | 78,0 | 82,2 |
| academico/asistencias?seccion | 64,1 | 134,4 | **600,1** |

Valores en ms. **Criterio de cierre (p95 < 300 ms) cumplido** en todas las rutas.

## Pendiente de decisión: índices del origen (no aplicados)

La regla es no modificar `investigacion_peruschool` sin consulta. Estos índices mejorarían las colas, pero no hacen falta para el criterio:

| Índice propuesto | Mejora | Costo |
|---|---|---|
| `asistencias (seccion_id, anio, fecha)` | Elimina el filesort de Q8 (p99 de 600 ms con concurrencia 4) | Unos 6 MB. Cambia el hash del esquema de origen frente al dump |
| `asistencias (fecha)` | Q7 sin `anio` por rango | Unos 4 MB |
| `calificaciones (registrada, periodo_id)` | Conteo de Q4 sin recorrido completo | Menos de 1 MB |

Alternativa sin tocar el origen: exigir `anio` cuando se filtra por `desde`/`hasta`, y cachear `datos/resumen` en memoria, porque el origen es inmutable.

## Actualización: `anio` obligatorio (ADR-002)

Se eligió no tocar el origen. Desde este cambio, `asistencias` exige `anio` cuando se filtra por `seccion`, `desde` o `hasta`. Medición nueva con concurrencia 4 (tres corridas): p99 de `anio&seccion` de 89 a 95 ms y p99 de `anio&desde&hasta` de 77 a 89 ms. El plan del filtro por sección no cambió (ver ADR-002 en `docs/decisiones.md`).
