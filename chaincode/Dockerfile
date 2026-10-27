# Chaincode como servicio (CCaaS, ADR-016). La imagen base está fijada por digest (infra/fabric/versiones.env).
ARG IMAGEN_NODE_CC
FROM ${IMAGEN_NODE_CC}

WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error
COPY src ./src

USER node
ENV CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999
EXPOSE 9999
# CHAINCODE_ID (package id) lo pasa deploy-cc.sh al crear el contenedor.
CMD ["sh", "-c", "exec ./node_modules/.bin/fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID"]
