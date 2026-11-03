# Límites de la supresión (F7.5)

**Qué hace `POST /api/v1/privacidad/:registroId/supresion` (solo estrategia B):** borra el detalle y las claves HMAC de todas las versiones, elimina el vínculo con el origen y ancla un evento `SUPRIMIR` sin datos personales. Después, verificar responde `DETALLE_RETIRADO`.

**Qué permanece:** en el ledger, los identificadores opacos, versiones, rol, fechas y HMAC. Sin la clave, el HMAC no permite comprobar el contenido, pero sigue ligado a un registro; que deje de ser dato personal es una cuestión jurídica, no algo que este prototipo demuestre.

**Qué no cubre:** respaldos de MySQL, logs binarios y páginas de InnoDB aún no reescritas; logs de Docker y de la aplicación; los archivos originales y la base de origen; copias fuera del control de los investigadores.

**No certifica el cumplimiento** de la Ley N.° 29733, su Reglamento ni del GDPR.

**Estrategia A:** solo admite revocación. El contenido, sintético en este prototipo, sigue legible en el ledger.

**Purga privada nativa:** el artículo incluye una comparación con `PurgePrivateData`, que este prototipo aún no implementa.

## Auditoría

`pnpm privacidad:auditar --bloques=<ledger del peer> --nombres=<lista fuera del repositorio>` busca identificadores del origen, claves HMAC, campos identificables y nombres. Falla si encuentra algo y no imprime el valor hallado. Sin `--nombres` no comprueba nombres.
