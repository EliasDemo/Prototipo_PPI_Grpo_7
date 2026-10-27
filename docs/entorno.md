# Entorno de ejecución

Este es el registro del hardware y el software donde se desarrolla y se mide el prototipo. Si cambia la máquina o un límite de recursos, las mediciones dejan de ser comparables: hay que anotar el cambio aquí y en un ADR.

## Hardware (anfitrión)

| Elemento | Valor |
|---|---|
| Equipo | ASUS ROG Strix G18 (G814JVR) |
| CPU | Intel Core i9-14900HX: 24 núcleos (8 P + 16 E) y 32 hilos |
| RAM | 31,6 GB |
| Disco | NVMe WD PC SN560 de 1 TB |
| Sistema anfitrión | Windows 11 Home 10.0.26200 |

## Virtualización

| Elemento | Valor |
|---|---|
| WSL2 | Ubuntu 24.04.5 LTS, kernel 6.6.87.2-microsoft-standard-WSL2 |
| Recursos de la VM de WSL2 | **Sin `.wslconfig`**: 32 CPU y 16 GB, que son los valores por defecto de WSL. Ver la nota de abajo |
| Docker | Docker Desktop, motor 29.4.0, backend WSL2 con integración en Ubuntu-24.04 |
| Node.js / pnpm | 22.23.4 (fnm) / 10.34.6 (corepack) |

> **Pendiente (F0.1):** fijar `.wslconfig` (por ejemplo, `memory=` y `processors=`). Exige `wsl --shutdown`, que detiene todos los contenedores de Docker Desktop, incluidos los de otros proyectos, así que lo decide el equipo. Mientras tanto, los recursos del experimento se fijan **por contenedor** (tabla siguiente). El i9-14900HX combina núcleos P y E, y Docker no fija a qué núcleos va cada contenedor: es una fuente de variación que se reporta como amenaza a la validez interna.

## Recursos fijos por contenedor

Son parámetros del experimento. Los valores salen de `infra/mysql/compose.yaml` y de `infra/fabric/versiones.env`.

| Contenedor | CPU | RAM | Rol |
|---|---|---|---|
| `ppi-mysql` | 2,0 | 3 GB | MySQL 8.4 (origen y laboratorio) |
| `orderer.example.com` | 1,0 | 1 GB | Orderer Raft (un nodo) |
| `peer0.org1.example.com` | 1,5 | 2 GB | Peer de Org1, LevelDB |
| `peer0.org2.example.com` | 1,5 | 2 GB | Peer de Org2, LevelDB |
| `cc-trazabilidad-org1` | 0,5 | 512 MB | Chaincode como servicio, el de Org1 |
| `cc-trazabilidad-org2` | 0,5 | 512 MB | Chaincode como servicio, el de Org2 |
| **Total** | **7,0** | **9 GB** | |

## Software de Fabric

Las versiones exactas y los digests de cada imagen están en `infra/fabric/versiones.env`.

| Componente | Versión |
|---|---|
| Hyperledger Fabric (peer, orderer y herramientas) | 2.5.16 |
| Fabric CA (binarios e imagen) | 1.5.22 |
| Base de la imagen del chaincode | node:20.19.5-alpine3.22 |
| fabric-contract-api / fabric-shim | 2.5.x (ver `chaincode/package.json`) |
