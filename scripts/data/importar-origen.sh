#!/bin/bash
# F1.2 · Importa el conjunto seudonimizado en investigacion_peruschool.
# Uso: pnpm db:import            (usa data/source/investigacion_mysql.sql)
#      pnpm db:import ruta.sql
set -euo pipefail
source "$(dirname "$0")/_mysql.sh"

ARCHIVO="${1:-$RAIZ/data/source/investigacion_mysql.sql}"

# 1. Protección: jamás importar la correspondencia privada
if [[ "$(basename "$ARCHIVO")" == *correspondencia* ]] || grep -qm1 'CREATE TABLE `identidades`' "$ARCHIVO"; then
  echo "ERROR: $ARCHIVO contiene la correspondencia privada. No se importa." >&2
  exit 1
fi
[[ -f "$ARCHIVO" ]] || { echo "ERROR: no existe $ARCHIVO" >&2; exit 1; }

# 2. No sobrescribir un origen ya importado
EXISTE=$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB_ORIGEN';" \
         | mysql_prep -N)
if [[ "$EXISTE" != "0" ]]; then
  echo "ERROR: $MYSQL_DB_ORIGEN ya tiene $EXISTE tablas. El origen no se reimporta." >&2
  echo "       Para empezar de cero: pnpm db:down -v  (borra el volumen) y vuelva a levantar." >&2
  exit 1
fi

HASH=$(sha256_de "$ARCHIVO")
echo "Importando $(basename "$ARCHIVO")  sha256=$HASH"
INICIO=$(date +%s)
mysql_prep < "$ARCHIVO" > /dev/null
echo "Importación terminada en $(( $(date +%s) - INICIO )) s."

# 3. Constancia de procedencia
mkdir -p "$RAIZ/artifacts/reports"
cat > "$RAIZ/artifacts/reports/importacion-origen.json" <<JSON
{
  "archivo": "$(basename "$ARCHIVO")",
  "sha256": "$HASH",
  "base": "$MYSQL_DB_ORIGEN",
  "importado_en": "$(date -Iseconds)"
}
JSON
echo "Constancia: artifacts/reports/importacion-origen.json"
echo "Siguiente paso: pnpm db:migrate && pnpm db:verify"
