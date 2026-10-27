#!/bin/bash
# Estado de la red: nodos, canal y chaincode. Código de salida 1 si algo falla.
# Uso: pnpm fabric:health            (incluye el chaincode)
#      pnpm fabric:health --sin-cc
source "$(dirname "$0")/_comun.sh"
set +e

SIN_CC=0
[[ "${1:-}" == "--sin-cc" ]] && SIN_CC=1
FALLAS=0
check() { # check "descripción" comando...
  local d="$1"; shift
  if salida=$("$@" 2>&1); then printf '✔ %s\n' "$d"; else printf '✘ %s\n%s\n' "$d" "$(echo "$salida" | tail -3 | sed 's/^/    /')"; FALLAS=$((FALLAS + 1)); fi
}

for c in orderer.example.com peer0.org1.example.com peer0.org2.example.com; do
  check "contenedor $c en ejecución" bash -c "[[ \$(docker inspect -f '{{.State.Running}}' $c) == true ]]"
done
check "orderer /healthz" healthz 9443
check "peer0.org1 /healthz" healthz 9444
check "peer0.org2 /healthz" healthz 9445

check "orderer: canal $CANAL activo (Raft)" bash -c "osnadmin channel list --channelID $CANAL -o localhost:7053 --ca-file '$ORDERER_CA' \
  --client-cert '$ORDERER_TLS/server.crt' --client-key '$ORDERER_TLS/server.key' | grep -q '\"status\": \"active\"'"

declare -A ALTURA
for n in 1 2; do
  usar_org "$n"
  check "peer0.org$n unido a $CANAL" peer channel getinfo -c "$CANAL"
  ALTURA[$n]=$(peer channel getinfo -c "$CANAL" 2>/dev/null | sed -E 's/.*"height":([0-9]+).*/\1/')
done
check "peers sincronizados (altura org1=${ALTURA[1]:-?} org2=${ALTURA[2]:-?})" bash -c "[[ -n '${ALTURA[1]:-}' && '${ALTURA[1]:-}' == '${ALTURA[2]:-}' ]]"

check "descubrimiento: el peer de Org1 ve al de Org2 (anchor peers)" descubrimiento_completo

if [[ $SIN_CC -eq 0 ]]; then
  check "chaincode trazabilidad confirmado en el canal" bash -c "peer lifecycle chaincode querycommitted -C $CANAL -n trazabilidad >/dev/null"
  for n in 1 2; do
    c="cc-trazabilidad-org$n"
    check "contenedor $c en ejecución" bash -c "[[ \$(docker inspect -f '{{.State.Running}}' $c) == true ]]"
    usar_org "$n"
    check "consulta al chaincode desde peer0.org$n" bash -c \
      "peer chaincode query -C $CANAL -n trazabilidad -c '{\"function\":\"HistorialRegistro\",\"Args\":[\"00000000-0000-4000-8000-000000000000\"]}' | grep -q '^\['"
  done
fi

if [[ $FALLAS -eq 0 ]]; then echo "Red sana."; else echo "$FALLAS comprobación(es) fallaron."; exit 1; fi
