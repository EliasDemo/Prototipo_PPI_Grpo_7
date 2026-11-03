#!/bin/bash
# Cierre de F4: invocar y consultar el chaincode desde la CLI del peer.
#  1) RegistrarEvidencia v1 y v2 con endorsement de Org1 Y Org2;
#  2) consulta desde ambos peers (mismo resultado);
#  3) una transacción respaldada solo por Org1 queda INVALIDADA por la política AND;
#  4) Revocar con código; el historial conserva todo.
# Uso: pnpm fabric:prueba
source "$(dirname "$0")/_comun.sh"

uuid() { cat /proc/sys/kernel/random/uuid; }
hex64() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
AMBOS=(--peerAddresses localhost:7051 --tlsRootCertFiles "$ORG_DIR/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
       --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG_DIR/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt")
SOLO_ORG1=("${AMBOS[@]:0:4}")

invocar() { # invocar "<args json>" peers...
  local args="$1"; shift
  peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CANAL" -n trazabilidad "$@" -c "$args" --waitForEvent 2>&1
}
# Captura la salida antes de buscar (grep -q con pipefail cortaría la tubería).
valida() { local s; s=$(invocar "$@"); grep -q "committed with status (VALID)" <<<"$s"; }
consultar() { peer chaincode query -C "$CANAL" -n trazabilidad -c "$1"; }
esc() { printf '%s' "$1" | sed 's/"/\\"/g'; }

REG=$(uuid); E1=$(uuid); E2=$(uuid); E3=$(uuid)
usar_org 1

echo "1) RegistrarEvidencia v1 y v2 (endorsement Org1 + Org2)"
V1="{\"evidenciaId\":\"$E1\",\"registroOpacoId\":\"$REG\",\"prevEvidenciaId\":null,\"version\":1,\"operacion\":\"CREAR\",\"actorRol\":\"operador\",\"hmac\":\"$(hex64)\",\"schemaVersion\":1}"
V2="{\"evidenciaId\":\"$E2\",\"registroOpacoId\":\"$REG\",\"prevEvidenciaId\":\"$E1\",\"version\":2,\"operacion\":\"RECTIFICAR\",\"actorRol\":\"operador\",\"hmac\":\"$(hex64)\",\"schemaVersion\":1}"
valida "{\"function\":\"RegistrarEvidencia\",\"Args\":[\"$(esc "$V1")\"]}" "${AMBOS[@]}" && echo "   v1 VALID" || { echo "   ✘ v1"; exit 1; }
valida "{\"function\":\"RegistrarEvidencia\",\"Args\":[\"$(esc "$V2")\"]}" "${AMBOS[@]}" && echo "   v2 VALID" || { echo "   ✘ v2"; exit 1; }

echo "2) Consulta desde ambos peers"
usar_org 1; H1=$(consultar "{\"function\":\"HistorialRegistro\",\"Args\":[\"$REG\"]}")
usar_org 2; H2=$(consultar "{\"function\":\"HistorialRegistro\",\"Args\":[\"$REG\"]}")
[[ "$H1" == "$H2" ]] && echo "   historial idéntico en peer0.org1 y peer0.org2 ($(echo "$H1" | grep -o '"version":[0-9]*' | tr '\n' ' '))" || { echo "   ✘ los peers difieren"; exit 1; }

echo "3) Transacción respaldada solo por Org1"
usar_org 1
V3="{\"evidenciaId\":\"$E3\",\"registroOpacoId\":\"$REG\",\"prevEvidenciaId\":\"$E2\",\"version\":3,\"operacion\":\"RECTIFICAR\",\"actorRol\":\"operador\",\"hmac\":\"$(hex64)\",\"schemaVersion\":1}"
SALIDA=$(invocar "{\"function\":\"RegistrarEvidencia\",\"Args\":[\"$(esc "$V3")\"]}" "${SOLO_ORG1[@]}" || true)
if echo "$SALIDA" | grep -q "ENDORSEMENT_POLICY_FAILURE"; then echo "   invalidada: ENDORSEMENT_POLICY_FAILURE (la política AND se aplica)"; else echo "   ✘ no fue invalidada:"; echo "$SALIDA" | tail -3; exit 1; fi
consultar "{\"function\":\"ObtenerEvidencia\",\"Args\":[\"$E3\"]}" >/dev/null 2>&1 && { echo "   ✘ la v3 quedó escrita"; exit 1; } || echo "   la v3 no existe en el ledger"

echo "4) Revocar v2 con código y verificar que nada se borró"
valida "{\"function\":\"Revocar\",\"Args\":[\"$E2\",\"ERROR_DE_REGISTRO\"]}" "${AMBOS[@]}" && echo "   revocación VALID" || { echo "   ✘ revocación"; exit 1; }
H=$(consultar "{\"function\":\"HistorialRegistro\",\"Args\":[\"$REG\"]}")
echo "$H" | grep -q '"motivoCodigo":"ERROR_DE_REGISTRO"' && [[ $(echo "$H" | grep -o '"tipo":"EVIDENCIA"' | wc -l) -eq 2 ]] \
  && echo "   historial: 2 evidencias intactas y la v2 marcada como revocada" || { echo "   ✘ historial inesperado: $H"; exit 1; }

echo "Prueba CLI correcta."
