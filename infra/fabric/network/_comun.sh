#!/bin/bash
# Variables y funciones comunes de los scripts de la red Fabric.
set -euo pipefail

RED="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABRIC="$(cd "$RED/.." && pwd)"
cd "$RED"

set -a; source "$FABRIC/versiones.env"; set +a
export PATH="$FABRIC/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC/config"

CANAL="trazabilidad"
ORG_DIR="$RED/organizations"
ORDERER_CA="$ORG_DIR/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
ORDERER_TLS="$ORG_DIR/ordererOrganizations/example.com/orderers/orderer.example.com/tls"
COMPOSE=(docker compose --env-file "$FABRIC/versiones.env" -f "$RED/compose.yaml")

[[ -x "$FABRIC/bin/peer" ]] || { echo "Faltan los binarios de Fabric: ver docs/entorno.md (install-fabric.sh)." >&2; exit 1; }

# usar_org N -> la CLI `peer` actúa como Admin de OrgN contra su peer (puerto publicado en localhost).
usar_org() {
  local n="$1" puerto
  [[ "$n" == 1 ]] && puerto=7051 || puerto=9051
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="Org${n}MSP"
  export CORE_PEER_TLS_ROOTCERT_FILE="$ORG_DIR/peerOrganizations/org${n}.example.com/peers/peer0.org${n}.example.com/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="$ORG_DIR/peerOrganizations/org${n}.example.com/users/Admin@org${n}.example.com/msp"
  export CORE_PEER_ADDRESS="localhost:${puerto}"
}

# Argumentos para hablar con el orderer desde el host.
ORDERER_ARGS=(-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA")

# reintentar N SEG comando... : reintenta hasta N veces con pausa SEG.
reintentar() {
  local n="$1" pausa="$2"; shift 2
  for ((i = 1; i <= n; i++)); do
    if "$@" >/tmp/fabric-ultimo.log 2>&1; then return 0; fi
    sleep "$pausa"
  done
  cat /tmp/fabric-ultimo.log >&2
  return 1
}

healthz() { curl -sf "http://127.0.0.1:$1/healthz" >/dev/null; }

# El descubrimiento de servicio (lo usa el Gateway para el endorsement AND) ve a ambos peers.
descubrimiento_completo() {
  local msp="$ORG_DIR/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
  discover --peerTLSCA "$ORG_DIR/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    --userKey "$(ls "$msp"/keystore/*)" --userCert "$msp/signcerts/Admin@org1.example.com-cert.pem" --MSP Org1MSP \
    peers --channel "$CANAL" --server localhost:7051 2>/dev/null | grep -q 'peer0.org2.example.com:9051'
}
