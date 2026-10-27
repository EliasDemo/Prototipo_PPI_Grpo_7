#!/bin/bash
# Detiene la red y borra TODO su estado: volúmenes (ledger), material criptográfico,
# chaincode desplegado y perfiles de conexión. `pnpm fabric:up` la reconstruye desde cero.
source "$(dirname "$0")/_comun.sh"

if [[ -f "$RED/.cc/cc.env" ]]; then
  docker compose --env-file "$FABRIC/versiones.env" --env-file "$RED/.cc/cc.env" -f "$RED/compose-cc.yaml" down -v --remove-orphans 2>&1 | grep -vE "^\s*$" || true
fi
docker rm -f cc-trazabilidad-org1 cc-trazabilidad-org2 >/dev/null 2>&1 || true
"${COMPOSE[@]}" down -v --remove-orphans 2>&1 | grep -vE "^\s*$" || true

rm -rf "$ORG_DIR" "$RED/channel-artifacts" "$RED/peercfg" "$RED/.cc"
find "$FABRIC/connection-profiles" -mindepth 1 ! -name README.md -exec rm -rf {} + 2>/dev/null || true
echo "Red Fabric eliminada (contenedores, volúmenes, material criptográfico y perfiles)."
