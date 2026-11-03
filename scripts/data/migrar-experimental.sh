#!/bin/bash
# F1.5 · Aplica en orden las migraciones pendientes de la base experimental.
# Uso: pnpm db:migrate
set -euo pipefail
source "$(dirname "$0")/_mysql.sh"

DIR="$RAIZ/database/experimental/migrations"

echo "CREATE DATABASE IF NOT EXISTS \`$MYSQL_DB_EXP\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS \`$MYSQL_DB_EXP\`.schema_migraciones (
  version VARCHAR(50) NOT NULL PRIMARY KEY,
  aplicada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sha256 CHAR(64) NOT NULL) ENGINE=InnoDB;" | mysql_prep

for f in "$DIR"/*.sql; do
  VERSION="$(basename "$f" .sql)"
  HASH="$(sha256_de "$f")"
  PREVIO=$(echo "SELECT sha256 FROM schema_migraciones WHERE version='$VERSION';" \
           | mysql_prep -N "$MYSQL_DB_EXP")
  if [[ -n "$PREVIO" ]]; then
    if [[ "$PREVIO" != "$HASH" ]]; then
      echo "ERROR: $VERSION ya aplicada pero el archivo cambió. Cree una migración nueva." >&2
      exit 1
    fi
    echo "  = $VERSION (ya aplicada)"
    continue
  fi
  echo "  + $VERSION"
  mysql_prep "$MYSQL_DB_EXP" < "$f"
  echo "INSERT INTO schema_migraciones (version, sha256) VALUES ('$VERSION','$HASH');" \
    | mysql_prep "$MYSQL_DB_EXP"
done
echo "Migraciones al día."
