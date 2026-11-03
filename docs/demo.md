# Guion de la demo (F10.5)

Antes: `pnpm db:up`, `pnpm fabric:up`, `pnpm build`, `EXPERIMENT_STRATEGY=B pnpm start`. Todo lo demás se hace en el navegador.

1. **Acceso.** Entra con el usuario operador.
2. **Datos.** Muestra la cobertura y las cinco diferencias, y aclara que las notas son bimestrales.
3. **Académico.** Filtra por año y sección.
4. **Laboratorio.** Crea una copia de una nota y rectifícala.
5. **Trazabilidad.** Abre el registro y verifica ambas versiones: "Coincide con el ledger".
6. **Alteración.** En una terminal, cambia a propósito el detalle (`UPDATE evento_detalle SET payload = JSON_SET(payload, '$.valorNumerico', '20.0000') WHERE evento_id = '…'`) y vuelve a verificar: "Alterado". Es el único paso con terminal, y es el ataque, no la operación normal.
7. **Revocar y suprimir.** Revoca otra copia y muestra que su contenido sigue disponible. Luego suprímela y verifica: "Detalle retirado".
8. **Estrategia A.** Reinicia con `EXPERIMENT_STRATEGY=A` y repite la supresión: responde que no está soportada.
9. **Límites.** Una misma parte administra todos los nodos, así que esto no resiste a quien controle la base, las claves y los peers.
