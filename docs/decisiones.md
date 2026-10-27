# Registro de decisiones (ADR)

Formato: contexto, decisión y consecuencias. Una decisión no se edita: si cambia, se agrega una nueva que la reemplace.

---

## ADR-001 · La base de origen es inmutable

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F1/F2

**Contexto.** `investigacion_peruschool` se importa una sola vez desde `investigacion_mysql.sql`, el conjunto seudonimizado. Los resultados del PPI deben poder reproducirse a partir de ese mismo archivo.

**Decisión.**
- No se modifica el origen: ni datos, ni esquema, ni índices.
- La aplicación lo lee con `app_ro`, que solo tiene `SELECT`. `app_exp` no tiene acceso al origen.
- La procedencia se verifica con el SHA-256 del dump (`010f070517b57c6ad36d768e927b09ae5617eb0b676d3c78b7d44251a30d8650`, en `artifacts/reports/importacion-origen.json`) y con `pnpm db:verify` (25 comprobaciones).
- Las suites de pruebas que escriben en la base experimental comprueban que el origen no cambió (F3.7).

**Consecuencias.** Las mejoras de rendimiento se hacen en las consultas o en la API, nunca con índices nuevos en el origen (ver ADR-002).

---

## ADR-002 · `anio` es obligatorio al filtrar asistencias por sección o fecha

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Contexto.** El único índice de fechas del origen es `idx_asistencia_fecha (anio, fecha)`. Un filtro `desde`/`hasta` sin `anio` no puede usarlo. En la medición inicial, `asistencias?seccion` mostró un p99 de 600 ms con concurrencia 4. Un índice nuevo en el origen lo evitaría, pero va contra ADR-001.

**Decisión.** `GET /api/v1/academico/asistencias` responde 400 `VALIDACION` (campo `anio`, con el mensaje "anio es obligatorio al filtrar por seccion, desde o hasta") cuando se filtra por `seccion`, `desde` o `hasta` sin `anio`. Sin filtros, la ruta sigue funcionando sin `anio`.

**Verificación (EXPLAIN ANALYZE).**
- `anio + desde/hasta`: recorrido por rango cubierto con `idx_asistencia_fecha` (1,3 ms para un mes).
- `anio + seccion`: el optimizador sigue eligiendo el índice `seccion_id` (unas 2.500 filas) más un sort, en 12–18 ms. Forzar `idx_asistencia_fecha` es **más lento** (37 ms), porque `seccion_id` no está en ese índice y cada fila requiere leer la tabla. Por eso no se fuerza.
- Latencia con concurrencia 4 y tres corridas: p99 de 91, 89 y 95 ms en `anio&seccion`, 89, 77 y 78 ms en `anio&desde&hasta`, y 81, 97 y 82 ms sin filtros.

**Consecuencias.** La regla garantiza el uso del índice en los filtros por fecha. Para el filtro por sección, el plan no cambia: el p99 de 600 ms medido antes no se repitió en tres corridas y probablemente fue una cola puntual, no un efecto de esta regla. Los clientes (la interfaz de F8 y Caliper) deben enviar `anio`.

---

## ADR-003 · Rutas de API en runtime Node.js, siempre dinámicas

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Contexto.** Next.js 16 con `cacheComponents: true` rechaza `export const runtime` y elimina `dynamic`. Una ruta GET que no lee nada del request podría pre-renderizarse en el build con datos congelados.

**Decisión.** No se exporta `runtime`, porque Node.js es el valor por defecto y `edge` está obsoleto. El wrapper `ruta()` / `rutaPublica()` (`src/server/http/ruta.ts`) llama a `connection()` antes de cada handler, y todas las respuestas llevan `Cache-Control: no-store`.

**Consecuencias.** Ninguna ruta de `/api/v1` se cachea ni se pre-renderiza (el build las marca como `ƒ`).

---

## ADR-004 · Las pruebas de integración usan HTTP contra `next start`

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Contexto.** `connection()` lanza un error fuera de un request de Next, así que los handlers no se pueden invocar directamente desde vitest.

**Decisión.** Vitest tiene dos proyectos: `unit`, sin servidor, y `integration`. El `globalSetup` de `integration` levanta `next start` en el puerto 3199 sobre el build actual (o usa `TEST_BASE_URL`) y lo detiene al terminar. `pnpm test:int` compila antes de probar.

**Consecuencias.** Las pruebas cubren el stack real: build, cabeceras, cookies y `cacheComponents`. Son más lentas que las pruebas unitarias.

---

## ADR-005 · Solo las listas se paginan

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Decisión.** Las listas (`estudiantes`, `calificaciones`, `asistencias`) responden `{ data, meta: { page, pageSize, total } }` con `pageSize` entre 1 y 200 (50 por defecto). Los objetos únicos (`datos/resumen`, `academico/catalogo` y `estudiantes/:id`) responden `{ data }`. Los errores responden `{ error: { code, message, detalles? } }`.

**Consecuencias.** El catálogo completo (37 asignaturas, 336 ofertas, 4 periodos y 57 secciones) se entrega en una sola respuesta.

---

## ADR-006 · Validación estricta de parámetros

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Decisión.** Los esquemas zod usan `.strict()`. Responde 400 si llega un parámetro desconocido, un parámetro repetido o un identificador que no cumple el formato seudónimo (`PREFIJO-` seguido de 20 caracteres hexadecimales en mayúscula; `PER-AAAA-N` para los periodos). Un `estudianteId` mal formado responde 404, igual que uno inexistente.

**Consecuencias.** Los errores de tipeo no se ignoran en silencio y ningún texto libre llega al SQL. Además, todo el SQL usa parámetros `?`.

---

## ADR-007 · Autenticación: el token Bearer tiene prioridad sobre la cookie

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Decisión.**
- Hay dos credenciales: `BENCH_TOKEN` (Bearer, para Caliper) y la cookie `ppi_sesion` del operador. La cookie se firma con HMAC-SHA256 y usa `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Si la petición trae `Authorization`, solo se evalúa ese token. Un token inválido responde 401 aunque también haya una cookie válida.
- El login verifica siempre la contraseña (scrypt) y responde lo mismo sea cual sea el campo incorrecto. Las comparaciones se hacen en tiempo constante.

**Consecuencias.** No hay sesiones en el servidor. Cerrar sesión borra la cookie del cliente, pero una cookie robada sigue siendo válida hasta que expira (`SESSION_TTL_SEGUNDOS`, 8 h).

---

## ADR-008 · Generación y custodia de secretos locales

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F2

**Decisión.**
- `SESSION_SECRET` y `BENCH_TOKEN` son aleatorios, de 48 bytes en base64url, y viven en `.env`, que está ignorado por git.
- `OPERADOR_PASSWORD_HASH` usa el formato `scrypt:N:r:p:sal:hash`, sin `$` para que dotenv no lo expanda. Se genera con `pnpm auth:hash`.
- La contraseña inicial del operador se guardó fuera del repositorio, en `~/.ppi-operador` (permisos 600).

**Consecuencias.** Cada integrante genera sus propios secretos. `env.ts` valida los formatos al arrancar y rechaza cualquier variable del servidor expuesta con el prefijo `NEXT_PUBLIC_`.
