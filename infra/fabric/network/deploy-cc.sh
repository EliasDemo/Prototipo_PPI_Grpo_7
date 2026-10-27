#!/bin/bash
# F4.5 Despliega (o actualiza) el chaincode `trazabilidad` como servicio (CCaaS, ADR-016).
#  - política de endorsement AND('Org1MSP.peer','Org2MSP.peer'): la MISMA para A y B;
#  - versión y secuencia incrementales: secuencia = la confirmada + 1, versión = secuencia;
#  - un contenedor de chaincode por organización, con recursos fijos (versiones.env).
# Uso: pnpm cc:deploy
source "$(dirname "$0")/_comun.sh"

CC=trazabilidad
POLITICA="AND('Org1MSP.peer','Org2MSP.peer')"
RAIZ="$(cd "$FABRIC/../.." && pwd)"
TRABAJO="$RED/.cc"
mkdir -p "$TRABAJO"

usar_org 1
ACTUAL=$(peer lifecycle chaincode querycommitted -C "$CANAL" -n "$CC" -O json 2>/dev/null | sed -nE 's/.*"sequence": ?([0-9]+).*/\1/p' || true)
SECUENCIA=$(( ${ACTUAL:-0} + 1 ))
VERSION="$SECUENCIA"
IMAGEN="ppi/trazabilidad-cc:v$VERSION"
echo "Chaincode $CC: versión $VERSION, secuencia $SECUENCIA, política $POLITICA"

echo "  imagen $IMAGEN"
docker build -q --build-arg IMAGEN_NODE_CC="$IMAGEN_NODE_CC" -t "$IMAGEN" "$RAIZ/chaincode" >/dev/null

declare -A PAQUETE
for n in 1 2; do
  # Paquete CCaaS: solo dice al peer dónde está el servidor del chaincode de su organización.
  dir="$TRABAJO/org$n"
  rm -rf "$dir" && mkdir -p "$dir/pkg"
  printf '{"address":"cc-trazabilidad-org%s:9999","dial_timeout":"10s","tls_required":false}\n' "$n" > "$dir/connection.json"
  printf '{"type":"ccaas","label":"%s_v%s_org%s"}\n' "$CC" "$VERSION" "$n" > "$dir/pkg/metadata.json"
  tar -C "$dir" -czf "$dir/pkg/code.tar.gz" connection.json
  tar -C "$dir/pkg" -czf "$dir/$CC-org$n.tar.gz" metadata.json code.tar.gz

  usar_org "$n"
  PAQUETE[$n]=$(peer lifecycle chaincode calculatepackageid "$dir/$CC-org$n.tar.gz")
  if ! peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "${PAQUETE[$n]}"; then
    echo "  instalando en peer0.org$n"
    reintentar 5 2 peer lifecycle chaincode install "$dir/$CC-org$n.tar.gz"
  fi
done

echo "  contenedores del chaincode"
cat > "$TRABAJO/cc.env" <<ENV
CC_IMAGEN=$IMAGEN
CC_ID_ORG1=${PAQUETE[1]}
CC_ID_ORG2=${PAQUETE[2]}
CC_TAMANO_MAX_EVENTO=${CC_TAMANO_MAX_EVENTO:-4096}
ENV
docker compose --env-file "$FABRIC/versiones.env" --env-file "$TRABAJO/cc.env" -f "$RED/compose-cc.yaml" up -d --force-recreate 2>&1 \
  | grep -vE "^\s*$" | sed 's/^/    /' || true

for n in 1 2; do
  echo "  aprobación de Org$n"
  usar_org "$n"
  reintentar 5 2 peer lifecycle chaincode approveformyorg "${ORDERER_ARGS[@]}" -C "$CANAL" -n "$CC" \
    --version "$VERSION" --sequence "$SECUENCIA" --package-id "${PAQUETE[$n]}" --signature-policy "$POLITICA" --waitForEvent
done

usar_org 1
PEERS=(--peerAddresses localhost:7051 --tlsRootCertFiles "$ORG_DIR/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
       --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG_DIR/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt")
peer lifecycle chaincode checkcommitreadiness -C "$CANAL" -n "$CC" --version "$VERSION" --sequence "$SECUENCIA" \
  --signature-policy "$POLITICA" -O json | grep -q '"Org2MSP": true' || { echo "Org2 no aprobó la definición" >&2; exit 1; }

echo "  confirmación de la definición en el canal"
reintentar 5 2 peer lifecycle chaincode commit "${ORDERER_ARGS[@]}" -C "$CANAL" -n "$CC" \
  --version "$VERSION" --sequence "$SECUENCIA" --signature-policy "$POLITICA" "${PEERS[@]}" --waitForEvent

for n in 1 2; do
  usar_org "$n"
  reintentar 30 1 peer chaincode query -C "$CANAL" -n "$CC" -c '{"function":"HistorialRegistro","Args":["00000000-0000-4000-8000-000000000000"]}'
done
echo "Chaincode $CC v$VERSION (secuencia $SECUENCIA) listo en ambos peers."
