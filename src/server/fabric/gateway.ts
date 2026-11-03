import "server-only";
import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import { connect, EndorseError, GatewayError, hash, signers, type Contract, type Gateway } from "@hyperledger/fabric-gateway";
import { env } from "@/server/config/env";

// Cliente del Fabric Gateway (F5.1): una conexión gRPC reutilizable por proceso, con la identidad
// de laboratorio User1@org1 (ADR-016). Las rutas de certificados vienen solo del .env del servidor.

interface Conexion {
  cliente: grpc.Client;
  gateway: Gateway;
  contrato: Contract;
}

const g = globalThis as typeof globalThis & { __ppiFabric?: Promise<Conexion> };

async function abrir(): Promise<Conexion> {
  const e = env();
  const faltan = (["FABRIC_PEER_ENDPOINT", "FABRIC_PEER_HOST_ALIAS", "FABRIC_MSP_ID", "FABRIC_CERT_PATH", "FABRIC_KEY_PATH", "FABRIC_TLS_CERT_PATH"] as const)
    .filter((k) => !e[k]);
  if (faltan.length) throw new Error(`Falta configurar Fabric en .env: ${faltan.join(", ")} (ver pnpm fabric:up)`);

  const [tls, cert, clave] = await Promise.all([
    readFile(e.FABRIC_TLS_CERT_PATH!),
    readFile(e.FABRIC_CERT_PATH!),
    readFile(e.FABRIC_KEY_PATH!),
  ]);
  const cliente = new grpc.Client(e.FABRIC_PEER_ENDPOINT!, grpc.credentials.createSsl(tls), {
    "grpc.ssl_target_name_override": e.FABRIC_PEER_HOST_ALIAS!,
    "grpc.keepalive_time_ms": 120000,
  });
  const ms = (n: number) => () => ({ deadline: Date.now() + n });
  const gateway = connect({
    client: cliente,
    identity: { mspId: e.FABRIC_MSP_ID!, credentials: cert },
    signer: signers.newPrivateKeySigner(createPrivateKey(clave)),
    hash: hash.sha256,
    evaluateOptions: ms(5000),
    endorseOptions: ms(15000),
    submitOptions: ms(5000),
    commitStatusOptions: ms(e.FABRIC_COMMIT_TIMEOUT_MS),
  });
  return { cliente, gateway, contrato: gateway.getNetwork(e.FABRIC_CHANNEL).getContract(e.FABRIC_CHAINCODE) };
}

/** Contrato `trazabilidad` sobre la conexión compartida (se abre la primera vez). */
export async function contrato(): Promise<Contract> {
  g.__ppiFabric ??= abrir().catch((err) => {
    g.__ppiFabric = undefined; // permite reintentar si la red aún no estaba lista
    throw err;
  });
  return (await g.__ppiFabric).contrato;
}

export async function cerrarFabric(): Promise<void> {
  const c = await g.__ppiFabric?.catch(() => undefined);
  g.__ppiFabric = undefined;
  c?.gateway.close();
  c?.cliente.close();
}

export interface ResultadoEnvio {
  txId: string;
  resultado: string;
  /** Respaldo (endorsement) + envío al orderer. */
  msSubmit: number;
  /** Espera del commit en el peer. */
  msCommit: number;
  /** true = VALID; false = el canal la invalidó (código en `codigo`). */
  confirmada: boolean;
  codigo: string;
}

/**
 * submitAsync + getStatus: separa el tiempo de envío del de confirmación (F5.7).
 * Lanza ErrorLedger si el chaincode rechaza la propuesta; si el commit no llega a tiempo,
 * lanza ErrorTimeoutCommit con el txId para que la bandeja (outbox) la concilie después (F6).
 */
export async function enviar(funcion: string, ...args: string[]): Promise<ResultadoEnvio> {
  const c = await contrato();
  const t0 = performance.now();
  let enviada;
  try {
    enviada = await c.submitAsync(funcion, { arguments: args });
  } catch (err) {
    throw aErrorLedger(err);
  }
  const t1 = performance.now();
  const txId = enviada.getTransactionId();
  let estado;
  try {
    estado = await enviada.getStatus();
  } catch (err) {
    throw new ErrorTimeoutCommit(txId, err instanceof Error ? err.message : String(err));
  }
  const t2 = performance.now();
  return {
    txId,
    resultado: new TextDecoder().decode(enviada.getResult()),
    msSubmit: t1 - t0,
    msCommit: t2 - t1,
    confirmada: estado.successful,
    codigo: CODIGOS[estado.code] ?? String(estado.code),
  };
}

/** Consulta (evaluate) sin pasar por el orderer. */
export async function consultar(funcion: string, ...args: string[]): Promise<string> {
  const c = await contrato();
  try {
    return new TextDecoder().decode(await c.evaluateTransaction(funcion, ...args));
  } catch (err) {
    throw aErrorLedger(err);
  }
}

/** Error devuelto por el chaincode (prefijo `CODIGO:`) o por la red. */
export class ErrorLedger extends Error {
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
  }
}

export class ErrorTimeoutCommit extends Error {
  constructor(
    readonly txId: string,
    message: string,
  ) {
    super(message);
  }
}

function aErrorLedger(err: unknown): Error {
  if (err instanceof GatewayError) {
    const mensajes = [err.message, ...err.details.map((d) => d.message)].join(" | ");
    const codigo = /\b([A-Z_]{4,}): /.exec(err.details.map((d) => d.message).join(" "))?.[1] ?? (err instanceof EndorseError ? "ENDORSEMENT" : "GATEWAY");
    return new ErrorLedger(codigo, mensajes);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Códigos de validación más comunes (peer.TxValidationCode).
const CODIGOS: Record<number, string> = {
  0: "VALID",
  10: "ENDORSEMENT_POLICY_FAILURE",
  11: "MVCC_READ_CONFLICT",
  12: "PHANTOM_READ_CONFLICT",
  254: "INVALID_OTHER_REASON",
};
