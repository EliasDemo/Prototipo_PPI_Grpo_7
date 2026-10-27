#!/bin/bash
# F1.6 · Vacía el laboratorio antes de cada corrida. NO toca el origen.
# Uso: pnpm db:reset-exp            (pide confirmación)
#      pnpm db:reset-exp --si       (sin confirmación; lo usa benchmarks/caliper/run.sh)
#      pnpm db:reset-exp --todo     (también borra experimentos y corridas)
set -euo pipefail
source "$(dirname "$0")/_mysql.sh"

TODO=0; SI=0
for a in "$@"; do
  case "$a" in --todo) TODO=1 ;; --si) SI=1 ;; esac
done

if [[ $SI -eq 0 ]]; then
  read -r -p "Se vaciará $MYSQL_DB_EXP (origen intacto). ¿Continuar? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || exit 0
fi

TABLAS="medicion muestra_recursos supresion operacion evento_clave evento_detalle evento registro"
[[ $TODO -eq 1 ]] && TABLAS="$TABLAS corrida experimento"

{
  echo "SET FOREIGN_KEY_CHECKS = 0;"
  for t in $TABLAS; do echo "TRUNCATE TABLE \`$t\`;"; done
  echo "SET FOREIGN_KEY_CHECKS = 1;"
} | mysql_prep "$MYSQL_DB_EXP"

echo "Laboratorio vacío: $TABLAS"
