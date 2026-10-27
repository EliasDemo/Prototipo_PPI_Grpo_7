#!/bin/bash
# Funciones comunes: cargan .env y ejecutan el cliente mysql dentro del contenedor.
# Si existe MYSQL_CLI (p. ej. "mysql"), se usa un cliente local en lugar de Docker.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -f "$RAIZ/.env" ]]; then
  set -a; source "$RAIZ/.env"; set +a
fi

MYSQL_DB_ORIGEN="${MYSQL_DB_ORIGEN:-investigacion_peruschool}"
MYSQL_DB_EXP="${MYSQL_DB_EXP:-investigacion_experimental}"
CONTENEDOR="${MYSQL_CONTAINER:-ppi-mysql}"

# mysql_prep [args...]  → cliente como usuario prep, lee SQL por stdin
mysql_prep() {
  if [[ -n "${MYSQL_CLI:-}" ]]; then
    $MYSQL_CLI "$@"
  else
    docker exec -i -e MYSQL_PWD="${MYSQL_PREP_PASSWORD:?Falta MYSQL_PREP_PASSWORD}" \
      "$CONTENEDOR" mysql -uprep --default-character-set=utf8mb4 "$@"
  fi
}

sha256_de() { sha256sum "$1" | awk '{print $1}'; }
