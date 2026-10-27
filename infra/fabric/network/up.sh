#!/bin/bash
# Levanta la red desde cero: material criptográfico, contenedores, canal y chaincode.
# Uso: pnpm fabric:up            (red + chaincode)
#      pnpm fabric:up --sin-cc   (solo la red y el canal)
source "$(dirname "$0")/_comun.sh"

SIN_CC=0
[[ "${1:-}" == "--sin-cc" ]] && SIN_CC=1
T0=$(date +%s.%N)
paso() { printf '[%6.1fs] %s\n' "$(awk -v a="$T0" -v b="$(date +%s.%N)" 'BEGIN { print b - a }')" "$*"; }

if docker ps -a --format '{{.Names}}' | grep -qE '^(orderer\.example\.com|peer0\.org[12]\.example\.com)$'; then
  echo "La red ya existe. Para recrearla: pnpm fabric:down && pnpm fabric:up" >&2
  exit 1
fi

paso "Material criptográfico (cryptogen)"
rm -rf "$ORG_DIR" channel-artifacts peercfg
cryptogen generate --config=crypto-config.yaml --output="$ORG_DIR" >/dev/null

paso "Bloque génesis del canal $CANAL"
mkdir -p channel-artifacts
configtxgen -configPath "$RED" -profile CanalTrazabilidad -channelID "$CANAL" \
  -outputBlock "channel-artifacts/$CANAL.block" 2>/dev/null

paso "core.yaml de los peers sin runtime Docker (vm.endpoint vacío; el chaincode corre como servicio)"
mkdir -p peercfg
sed -E 's#^(    endpoint: )unix:///var/run/docker.sock#\1""#' "$FABRIC/config/core.yaml" > peercfg/core.yaml
grep -qE '^    endpoint: ""' peercfg/core.yaml || { echo "No se pudo desactivar vm.endpoint en core.yaml" >&2; exit 1; }

paso "Contenedores (orderer, peer0.org1, peer0.org2)"
"${COMPOSE[@]}" up -d --quiet-pull 2>&1 | grep -vE "^\s*$" | sed 's/^/    /' || true
for puerto in 9443 9444 9445; do
  reintentar 60 0.5 healthz "$puerto" || { echo "El nodo con operaciones en :$puerto no respondió" >&2; exit 1; }
done

paso "El orderer se une al canal (osnadmin)"
reintentar 20 0.5 osnadmin channel join --channelID "$CANAL" --config-block "channel-artifacts/$CANAL.block" \
  -o localhost:7053 --ca-file "$ORDERER_CA" \
  --client-cert "$ORDERER_TLS/server.crt" --client-key "$ORDERER_TLS/server.key"

for n in 1 2; do
  paso "peer0.org$n se une al canal"
  usar_org "$n"
  reintentar 20 1 peer channel join -b "channel-artifacts/$CANAL.block"
done

paso "Esperando a que ambos peers vean el bloque génesis"
for n in 1 2; do
  usar_org "$n"
  reintentar 30 0.5 peer channel getinfo -c "$CANAL"
done

paso "Esperando la convergencia del gossip (descubrimiento ve a Org1 y Org2)"
reintentar 60 0.5 descubrimiento_completo || { echo "El descubrimiento no vio a ambos peers en 30 s" >&2; exit 1; }

if [[ $SIN_CC -eq 0 ]]; then
  paso "Desplegando el chaincode"
  bash "$RED/deploy-cc.sh"
fi

bash "$RED/perfiles.sh" >/dev/null
paso "Red lista"
