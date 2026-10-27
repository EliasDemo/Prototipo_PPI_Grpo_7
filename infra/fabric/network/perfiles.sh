#!/bin/bash
# F4.6 Copia la identidad cliente de laboratorio (User1@org1) y el CA TLS del peer a
# infra/fabric/connection-profiles (ignorado por git) y muestra las variables para .env.
source "$(dirname "$0")/_comun.sh"

DEST="$FABRIC/connection-profiles/org1"
USUARIO="$ORG_DIR/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp"
rm -rf "$DEST" && mkdir -p "$DEST"
cp "$USUARIO/signcerts/"*.pem "$DEST/user1-cert.pem"
cp "$USUARIO/keystore/"* "$DEST/user1-key.pem"
cp "$ORG_DIR/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" "$DEST/peer0-tls-ca.pem"
chmod 600 "$DEST/user1-key.pem"

cat <<ENV
# Pegar en .env (solo del servidor; nunca con NEXT_PUBLIC_):
FABRIC_PEER_ENDPOINT=localhost:7051
FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_MSP_ID=Org1MSP
FABRIC_CERT_PATH=$DEST/user1-cert.pem
FABRIC_KEY_PATH=$DEST/user1-key.pem
FABRIC_TLS_CERT_PATH=$DEST/peer0-tls-ca.pem
ENV
