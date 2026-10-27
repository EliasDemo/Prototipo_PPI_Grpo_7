#!/bin/bash
# Se ejecuta UNA sola vez, cuando el volumen de MySQL está vacío.
# Crea las cuentas separadas que exige el plan (sección 2 y F1.3).
set -euo pipefail

: "${MYSQL_PREP_PASSWORD:?Falta MYSQL_PREP_PASSWORD en .env}"
: "${MYSQL_RO_PASSWORD:?Falta MYSQL_RO_PASSWORD en .env}"
: "${MYSQL_EXP_PASSWORD:?Falta MYSQL_EXP_PASSWORD en .env}"

DB_ORIGEN="${MYSQL_DB_ORIGEN:-investigacion_peruschool}"
DB_EXP="${MYSQL_DB_EXP:-investigacion_experimental}"

mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_EXP}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- prep: solo para importar el origen y aplicar migraciones
CREATE USER IF NOT EXISTS 'prep'@'%' IDENTIFIED BY '${MYSQL_PREP_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_ORIGEN}\`.* TO 'prep'@'%';
GRANT ALL PRIVILEGES ON \`${DB_EXP}\`.*    TO 'prep'@'%';

-- app_ro: la aplicación lee el origen, nunca lo modifica
CREATE USER IF NOT EXISTS 'app_ro'@'%' IDENTIFIED BY '${MYSQL_RO_PASSWORD}';
GRANT SELECT ON \`${DB_ORIGEN}\`.* TO 'app_ro'@'%';

-- app_exp: la aplicación escribe solo en el laboratorio
CREATE USER IF NOT EXISTS 'app_exp'@'%' IDENTIFIED BY '${MYSQL_EXP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_EXP}\`.* TO 'app_exp'@'%';

FLUSH PRIVILEGES;
SQL

echo "[init] Usuarios prep, app_ro y app_exp creados."
