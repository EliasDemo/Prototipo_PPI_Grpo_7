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

---

## ADR-009 · Integración contra `next dev` con NullLedger (reemplaza a ADR-004)

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Contexto.** NullLedger no debe poder activarse en producción. `next build` fija `NODE_ENV=production` en el código compilado, así que un build nunca puede usarlo, y las pruebas de eventos necesitan un ledger.

**Decisión.** El `globalSetup` de integración levanta `next dev` con `LEDGER=null` en el puerto 3199. `pnpm test:int` ya no compila antes. El build se comprueba aparte con `pnpm build`. La latencia (`pnpm latencia:api`) se sigue midiendo contra `next start`.

**Consecuencias.** La primera solicitud a cada ruta incluye su compilación en modo dev, por lo que los tiempos de las pruebas no sirven como medición. El `globalSetup` además toma una huella del origen (filas y `CHECKSUM TABLE` de las 11 tablas) antes de la suite, y la suite falla si al terminar es distinta (ADR-001).

---

## ADR-010 · NullLedger: semántica híbrida sobre una tabla append-only

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Decisión.**
- `LEDGER=fabric|null`, con `fabric` por defecto. `env.ts` rechaza `null` con `NODE_ENV=production` y el constructor de `NullLedger` también.
- NullLedger aplica la estrategia B: el detalle y la clave quedan en MySQL, y la evidencia con HMAC va a `ledger_simulado`, una tabla con triggers que impiden UPDATE y DELETE.
- Sigue el mismo flujo que se usará con Fabric: transacción en MySQL con la operación `PENDIENTE`, luego el anclaje fuera de esa transacción y por último la confirmación local. Si el evidenciaId ya existe con el mismo HMAC, se considera "ya confirmado".
- Los registros creados con NullLedger quedan con `estrategia = 'B'`. Antes de cada corrida del benchmark se ejecuta `db:reset-exp`, que también vacía `ledger_simulado`.

---

## ADR-011 · Formato de firma de eventos (schemaVersion 1)

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Decisión.**
- **Serialización canónica:** claves ordenadas por unidades UTF-16 (compatible con RFC 8785 para enteros), sin espacios y con `schemaVersion: 1`. Solo se admiten enteros seguros; los decimales viajan como texto exacto (`"18.5000"`, leído del origen con `CAST(valor_numerico AS CHAR)`). Se rechazan `undefined`, `NaN`, `±Infinity`, `-0`, `Date` y los objetos que no son planos.
- **Qué se firma:** `{ eventoId, registroId, version, operacion, prevEventoId, payload }`. Ni el actor ni la fecha entran en la firma: la fecha va en la evidencia del ledger.
- **HMAC-SHA256** con una clave aleatoria de 32 bytes por evento, guardada en `evento_clave` y comparada con `timingSafeEqual`.
- Los vectores fijos de `tests/unit/canonical.test.ts` congelan el formato. Si cambian, se sube `SCHEMA_VERSION`; los vectores no se editan.

---

## ADR-012 · Contenido del payload y del ledger

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Decisión.**
- **El payload no incluye el estudiante.** Solo lleva identificadores seudónimos del catálogo (oferta, asignatura, sección y periodo) y el valor académico tal como aparece en la fuente. El vínculo con la fila de origen vive únicamente en `registro.origen_id`, que la supresión borrará en F7.
- **El motivo de una rectificación**, que es texto libre, se guarda en el payload (`evento_detalle`, suprimible) y no en `evento.motivo`, que es de solo-anexar y quedará siempre en NULL. Así, un nombre escrito por error en ese campo se puede retirar.
- **El actor es un rol** (`operador` o `benchmark`), nunca un nombre.
- **La evidencia** (B y NullLedger) solo contiene ids opacos, la operación, la versión, la fecha, el HMAC y `schemaVersion`.

---

## ADR-013 · Idempotencia de los POST

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Decisión.**
- Todos los POST exigen `Idempotency-Key`: entre 8 y 100 caracteres de `[A-Za-z0-9._:-]`.
- La huella de cada solicitud es `SHA-256(canonical({ ruta, cuerpo }))`, donde la ruta incluye los ids de la URL.
- Si llega la misma key con la misma huella, se devuelve la respuesta guardada con la cabecera `Idempotent-Replayed: true`. Con otra huella, se responde 422 `IDEMPOTENCIA_CONFLICTO`; si la primera solicitud sigue en curso, 409 `SOLICITUD_EN_CURSO`.
- Se guardan las respuestas de éxito y los errores de negocio (404 y 409). Los 400 de validación y los 500 no se guardan y liberan la key, porque la solicitud no llegó a ejecutarse.
- La misma key identifica la operación hacia el ledger (`operacion.idempotency_key`).
- `POST /trazabilidad/:id/verificar` también exige la key: un reintento con la misma key devuelve el resultado ya emitido, aunque los datos hayan cambiado después.

---

## ADR-014 · Control de versiones en las rectificaciones

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F3

**Decisión.**
- La rectificación parte de la versión que el cliente indica (`versionEsperada`).
- Dentro de la transacción se ejecuta `SELECT … FROM registro … FOR UPDATE` y se exige `version_actual = versionEsperada`. Si no coincide, responde 409 `VERSION_DESACTUALIZADA` con `versionActual`. `UNIQUE(registro_id, version)` actúa como respaldo.
- Con cinco rectificaciones concurrentes sobre la misma versión, en las pruebas siempre gana una y las otras cuatro reciben 409.
- Por exigencia de Next.js, `eventos/[id]` y `trazabilidad/[id]` comparten el nombre del segmento dinámico: `[id]` es el eventoId o el registroId según la ruta.

---

## ADR-015 · Alineación del protocolo experimental con el artículo presentado

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** transversal (F4 a F10)

**Contexto.** Cuando el artículo presentado y `PLAN_DESARROLLO.md` difieren, manda el artículo. La matriz anterior del plan (TPS 10/50/100, workers 2/4/8, 15 s y 60 s, 180 corridas) no coincidía con él.

**Decisión.**
- **Cargas candidatas:** 5, 10, 25 y 50 escrituras/s. Las definitivas se fijan después del piloto, y ese cambio se documenta en un ADR nuevo.
- **Protocolo:** calentamiento de 60 s, observación de 180 s, 5 repeticiones y orden A/B alternado.
- **Herramientas:** Caliper para los TPS confirmados, la latencia de envío a confirmación y el éxito; JMeter, en corridas separadas, para la latencia de extremo a extremo de la API.
- **Métricas:** media, p50 y p95, tasa de éxito, dispersión entre repeticiones, CPU y RAM, profundidad de la cola y tamaño del payload.
- **Terminología:** el flujo `PENDIENTE` → anclaje → `CONFIRMADA` (ADR-010, F6) se llama **bandeja transaccional (outbox)** en toda la documentación. La operación `PENDIENTE` se escribe en la misma transacción de MySQL que el cambio académico, como pide el artículo. La profundidad de la cola es el número de operaciones `PENDIENTE` o `ENVIADA`.
- **Modo A:** Fabric recibe eventos **sintéticos no identificables** con la misma estructura y el mismo tamaño que los reales. Ningún dato del conjunto, ni siquiera seudónimo, llega completo al ledger.

**Pendiente de decisión del equipo.** El short paper (sección II.B, RQ3) compara contra una **línea base de solo base de datos** ("database-only baseline"), y la matriz solo compara A contra B. También indica que el evento anclado incluye el **rol del actor**, que no está entre los campos permitidos de `RegistrarEvidencia`. Ninguno de los dos se implementa sin una decisión explícita.

**Consecuencias.** `PLAN_DESARROLLO.md` (secciones 1, F4.3, F5.2, F6.1 y F9) queda actualizado. La matriz candidata tiene 80 corridas.

---

## ADR-016 · Red Fabric: chaincode como servicio y parámetros fijos

**Fecha:** 27/10/2026 · **Estado:** aceptada · **Fase:** F4

**Contexto.** El runtime clásico de chaincode obliga al peer a construir y lanzar contenedores mediante el socket de Docker. Esos contenedores escapan a los límites de recursos de compose y el peer necesita acceso privilegiado al daemon. Además, `CORE_VM_ENDPOINT=""` no desactiva ese runtime, porque viper ignora las variables de entorno vacías.

**Decisión.**
- **Chaincode como servicio (CCaaS).** Hay un contenedor por organización (`cc-trazabilidad-org1` y `-org2`) con 0,5 CPU y 512 MB fijos, cada uno con su propio paquete y su `connection.json`. La definición del chaincode (nombre, versión, secuencia y política) es única para el canal. El peer usa un `core.yaml` generado con `vm.endpoint` vacío: no tiene acceso a Docker y `/healthz` no depende de él.
- **Conexión entre el peer y el chaincode:** sin TLS, dentro de la red Docker interna `ppi-fabric`, que no publica el puerto 9999. Es una simplificación de laboratorio y se reporta como límite.
- **Política de endorsement** `AND('Org1MSP.peer','Org2MSP.peer')`, igual para A y B. `fabric:prueba` demuestra que una transacción respaldada solo por Org1 queda invalidada (`ENDORSEMENT_POLICY_FAILURE`).
- **Parámetros fijos del experimento:**
  - un orderer Raft (1 CPU, 1 GB) y dos peers (1,5 CPU y 2 GB cada uno);
  - LevelDB;
  - `BatchTimeout` de 2 s, `MaxMessageCount` de 10 y `PreferredMaxBytes` de 512 KB;
  - `TAMANO_MAX_EVENTO` de 4096 bytes (modo A), igual en ambos contenedores para que el chaincode sea determinista.
- **Material criptográfico** generado con `cryptogen`, solo con identidades de laboratorio. La identidad cliente es `User1@org1.example.com` (OU client). Nada de eso entra al repositorio: `.gitignore` lo excluye y el script de commit aborta si se prepara un archivo así.
- **Contrato:**
  - `REVOCAR` no ocupa una versión de la cadena: es un registro aparte (`revocacion~evidencia`), con el motivo tomado de una lista cerrada de códigos.
  - Las operaciones encadenadas por versión son `CREAR`, `RECTIFICAR` y `SUPRIMIR`.
  - Los errores llevan un prefijo `CODIGO:` para que el cliente los distinga en F5.

**Consecuencias.**
- `BatchTimeout` y `MaxMessageCount` condicionan la latencia de confirmación a cargas bajas: con pocas transacciones, el bloque se corta por tiempo. Hay que reportarlos junto a los resultados.
- Un solo orderer no tolera fallos (Raft con un nodo). Es suficiente para medir A frente a B en igualdad de condiciones, pero no es una configuración de producción.
- **Pendiente de decisión del equipo:** el short paper menciona el rol del actor en el evento anclado (ADR-015), y `RegistrarEvidencia` no lo admite. *(Resuelto en ADR-017.)*

---

## ADR-017 · Línea base sin ledger (BD) y rol del actor en el ledger

**Fecha:** 03/11/2026 · **Estado:** aceptada · **Fase:** F5

**Contexto.** El artículo (RQ3) mide la sobrecarga del anclaje "relative to a database-only baseline". También indica que cada evento anclado incluye el rol del actor. Los dos puntos quedaron pendientes en ADR-015 y ADR-016. El equipo pidió avanzar cumpliendo lo planteado.

**Decisión.**
- **Estrategia `BD`, la línea base.** Usa la misma API, los mismos casos de uso, la misma idempotencia y la misma bandeja transaccional en MySQL (detalle, clave y HMAC incluidos), pero no ancla en ningún ledger: la operación pasa a `CONFIRMADA` sin enviar nada. Se elige con `EXPERIMENT_STRATEGY=BD` y no requiere Fabric. Su verificación responde `SIN_EVIDENCIA`, porque no hay ledger contra el cual comparar.
- **Estrategias de la matriz:** `BD`, A y B, con el orden rotado en cada repetición. La matriz candidata de ADR-015 pasa de 80 a 120 corridas (3 × 4 × 2 × 5).
- **`actorRol` en el ledger:** es un campo obligatorio en `RegistrarEvidencia` y `RegistrarEventoCompleto`, restringido a los códigos `operador` y `benchmark`. El chaincode rechaza cualquier otro valor. La verificación compara `evento.actor` (MySQL) con el `actorRol` anclado. El rol no entra en la firma HMAC (ADR-011 no cambia): queda protegido por el propio ledger.
- **Migración 004:** `registro.estrategia` y `corrida.estrategia` admiten `BD`, y `medicion` registra la estrategia y la operación aunque no haya corrida (`corrida_id` puede ser NULL; llega en la cabecera `X-Corrida-Id`).

**Consecuencias.** La RQ3 se puede responder comparando A y B contra `BD` con la misma lógica de aplicación. El chaincode quedó desplegado en la versión 2 (secuencia 2).

---

## ADR-018 · Validación fuera del equipo del experimento

**Fecha:** 03/11/2026 · **Estado:** aceptada · **Fase:** F5 en adelante

**Contexto.** Parte del desarrollo se validó en un contenedor sin el dump real ni acceso a Docker Hub.

**Decisión.**
- Se valida con Fabric 2.5.16 real (binarios oficiales, chaincode como servicio) y MySQL 8.0 local, con `tests/soporte/origen-sintetico.sql` como origen. Ese archivo no contiene datos del colegio.
- Esa validación prueba el comportamiento funcional. **No produce mediciones**: sus tiempos no se reportan y `pnpm db:verify` y `tests/integration/academico.test.ts` siguen exigiendo el dump real.

**Consecuencias.** Antes de medir hay que repetir las suites en el equipo del experimento, con MySQL 8.4 y `pnpm fabric:up`. Ver `docs/verificacion.md`.

---

## ADR-019 · Bandeja con mensaje, conciliación y revocación fuera de la cadena de versiones

**Fecha:** 03/11/2026 · **Estado:** aceptada · **Fase:** F6 y F7

**Decisión.**
- **Mensaje en la bandeja (migración 006).** `operacion` guarda la función y el JSON exactos hacia el ledger, en la misma transacción. Sin esto, A no podría reenviar: su contenido sintético es aleatorio y su compromiso ya está guardado. No contiene datos del conjunto y se vacía al confirmarse.
- **Una versión solo se encadena sobre otra confirmada.** Si la anterior sigue en la bandeja, responde 409 `CONFLICTO`, porque el chaincode rechazaría la siguiente versión.
- **Reintentos (F6.3).** `OUTBOX_MAX_INTENTOS` (3) y `OUTBOX_BACKOFF_MS` (200, se duplica) solo para fallas de red y conflictos MVCC. Un rechazo del chaincode no se repite. Un timeout de commit lo resuelve la conciliación.
- **`TARDIA`:** la solicitud se quedó sin respuesta de commit y luego el ledger mostró la transacción. Tras un corte del proceso, si el ledger la tiene, es `CONFIRMADA`.
- **Revocación:** tabla `revocacion`, sin ocupar una versión, igual que en el ledger (ADR-016). El plan pedía "un evento REVOCAR": se cambia para que MySQL y el ledger numeren igual y SUPRIMIR pueda encadenarse.
- **SUPRIMIR:** el HMAC anclado usa una clave de un solo uso que no se guarda, porque el chaincode exige el campo y no hay contenido que firmar.
- **Inyección de fallos:** `FALLO_INYECTADO`, ignorada con `NODE_ENV=production`.

**Consecuencias.** La bandeja escribe un poco más por operación en A y B, y eso forma parte de lo que se mide. Si una versión termina `FALLIDA`, el registro queda sin poder avanzar: es deliberado y requiere revisión manual.
