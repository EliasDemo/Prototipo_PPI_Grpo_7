import "server-only";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Confirmacion, EventoAcademico, EventoNuevo } from "@/modules/eventos/tipos";
import { env } from "@/server/config/env";
import { ErrorLedger, ErrorTimeoutCommit } from "@/server/fabric/gateway";
import { ErrorApi } from "@/server/http/respuestas";
import { falloInyectado } from "./fallos";
import {
  actualizarRevocacion,
  anotarTxPendiente,
  confirmarOperacion,
  insertarEvento,
  insertarRevocacion,
  marcarEnviada,
  marcarFallida,
  registrarMedicion,
  type MaterialEvento,
  type Medicion,
} from "./persistencia-mysql";
import { conReintentos, type Intentable } from "./reintentos";
import type { SolicitudRevocacion } from "./tipos";

// Bandeja transaccional (outbox) común a todas las estrategias (ADR-015, F5/F6):
//   1) MySQL: cambio académico + operación PENDIENTE + mensaje, en UNA transacción;
//   2) la operación pasa a ENVIADA y se ancla en el ledger (salvo BD), con reintentos (F6.3);
//   3) CONFIRMADA si el commit es VALID; FALLIDA si el ledger la rechaza o invalida;
//      si el commit no responde a tiempo queda ENVIADA con su txId para `pnpm reconcile` (F6.4).
// Cada operación deja una fila en `medicion` con los tiempos de cada etapa (F5.7).

export interface Anclaje {
  txId: string;
  confirmada: boolean;
  codigo: string;
  msSubmit: number;
  msCommit: number;
  bytesOnchain: number;
}

/** Solo fallas pasajeras. Un rechazo del chaincode se repetiría igual; un timeout de commit lo resuelve la conciliación. */
export function clasificarFallo(e: unknown): Intentable {
  if (e instanceof ErrorTimeoutCommit) return "definitivo";
  if (e instanceof ErrorLedger) return e.codigo === "GATEWAY" ? "reintentar" : "definitivo";
  return "reintentar";
}

const invalidadaPasajera = (a: Anclaje) => !a.confirmada && (a.codigo === "MVCC_READ_CONFLICT" || a.codigo === "PHANTOM_READ_CONFLICT");

export function anclarConReintentos(anclar: () => Promise<Anclaje>, alIntentar: () => Promise<void>): Promise<Anclaje> {
  const e = env();
  return conReintentos(anclar, { maxIntentos: e.OUTBOX_MAX_INTENTOS, backoffMs: e.OUTBOX_BACKOFF_MS, clasificarFallo, repetir: invalidadaPasajera, alIntentar });
}

export interface FlujoOutbox {
  estrategia: Medicion["estrategia"];
  nuevo: EventoNuevo;
  versionEsperada: number;
  material: MaterialEvento;
  /** null = línea base BD (sin ledger). */
  anclar: (() => Promise<Anclaje>) | null;
  /** Se ejecuta tras confirmar (A: borrar el detalle temporal). */
  alConfirmar?: () => Promise<void>;
}

export async function registrarConOutbox(f: FlujoOutbox): Promise<Confirmacion> {
  const { evento, corridaId } = f.nuevo;
  const inicio = performance.now();
  const { opId } = await insertarEvento(f.nuevo, f.versionEsperada, f.material);
  return anclarOperacion({
    opId, estrategia: f.estrategia, evento, corridaId: corridaId ?? null, inicio, tMysql: performance.now() - inicio,
    bytesOffchain: f.material.temporal ? 0 : f.material.bytes, anclar: f.anclar, alConfirmar: f.alConfirmar,
  });
}

export interface PasoAnclaje {
  opId: string;
  estrategia: Medicion["estrategia"];
  evento: EventoAcademico;
  corridaId: string | null;
  inicio: number;
  tMysql: number;
  bytesOffchain: number;
  anclar: (() => Promise<Anclaje>) | null;
  alConfirmar?: () => Promise<void>;
}

/** Pasos 2 y 3 de la bandeja, cuando la operación ya quedó PENDIENTE en MySQL. */
export async function anclarOperacion(p: PasoAnclaje): Promise<Confirmacion> {
  const { evento } = p;
  const confirmacion = (estadoOperacion: Confirmacion["estadoOperacion"], txId: string | null): Confirmacion => ({
    eventoId: evento.eventoId, registroId: evento.registroId, version: evento.version,
    operacion: evento.operacion, estadoOperacion, txId,
  });
  const medir = (resultado: Medicion["resultado"], a?: Partial<Anclaje>) =>
    registrarMedicion({
      opId: p.opId, corridaId: p.corridaId, estrategia: p.estrategia, operacion: evento.operacion, resultado,
      tMysqlMs: p.tMysql, tFabricSubmitMs: a?.msSubmit ?? null, tFabricCommitMs: a?.msCommit ?? null,
      tTotalMs: performance.now() - p.inicio, bytesOnchain: a?.bytesOnchain ?? null, bytesOffchain: p.bytesOffchain,
    });

  falloInyectado("antes-de-anclar");

  if (!p.anclar) {
    await confirmarOperacion(evento.eventoId, null, "SIN_LEDGER");
    await medir("CONFIRMADA", { bytesOnchain: 0 });
    return confirmacion("CONFIRMADA", null);
  }

  let a: Anclaje;
  try {
    a = await anclarConReintentos(p.anclar, () => marcarEnviada(evento.eventoId));
  } catch (e) {
    if (e instanceof ErrorTimeoutCommit) {
      await anotarTxPendiente(evento.eventoId, e.txId, e.message);
      await medir("TIMEOUT");
      return confirmacion("ENVIADA", e.txId);
    }
    if (e instanceof ErrorLedger && e.codigo !== "GATEWAY") {
      await marcarFallida(evento.eventoId, e.codigo, e.message);
      await medir("RECHAZADA");
      throw new ErrorApi("LEDGER_RECHAZO", "El ledger rechazó la transacción", { codigo: e.codigo, eventoId: evento.eventoId });
    }
    // No se sabe si llegó al ledger: queda ENVIADA para la conciliación (F6).
    console.error("[outbox] error al anclar", e);
    await medir("FALLIDA");
    throw new ErrorApi("NO_DISPONIBLE", "Ledger no disponible; la operación quedó en la bandeja para conciliarse", {
      eventoId: evento.eventoId,
    });
  }

  falloInyectado("tras-anclar");

  if (!a.confirmada) {
    await marcarFallida(evento.eventoId, a.codigo, "transacción invalidada por el canal", a.txId);
    await medir("FALLIDA", a);
    throw new ErrorApi("LEDGER_RECHAZO", `El canal invalidó la transacción (${a.codigo})`, {
      codigo: a.codigo, txId: a.txId, eventoId: evento.eventoId,
    });
  }

  await confirmarOperacion(evento.eventoId, a.txId, a.codigo);
  await p.alConfirmar?.();
  await medir("CONFIRMADA", a);
  return confirmacion("CONFIRMADA", a.txId);
}

/** Revocación (F7.1). `anclar` null = BD. */
export async function revocarConOutbox(estrategia: Medicion["estrategia"], s: SolicitudRevocacion, anclar: (() => Promise<Anclaje>) | null): Promise<Confirmacion> {
  const revocacionId = randomUUID();
  const inicio = performance.now();
  await insertarRevocacion({ ...s, revocacionId });
  const tMysql = performance.now() - inicio;
  const confirmacion = (estadoOperacion: Confirmacion["estadoOperacion"], txId: string | null): Confirmacion => ({
    eventoId: s.evidenciaId, registroId: s.registroId, version: s.version, operacion: "REVOCAR", estadoOperacion, txId,
  });
  const medir = (resultado: Medicion["resultado"], a?: Partial<Anclaje>) =>
    registrarMedicion({
      opId: revocacionId, corridaId: s.corridaId, estrategia, operacion: "REVOCAR", resultado, tMysqlMs: tMysql,
      tFabricSubmitMs: a?.msSubmit ?? null, tFabricCommitMs: a?.msCommit ?? null, tTotalMs: performance.now() - inicio,
      bytesOnchain: a?.bytesOnchain ?? null, bytesOffchain: 0,
    });

  if (!anclar) {
    await actualizarRevocacion(revocacionId, "CONFIRMADA", null);
    await medir("CONFIRMADA", { bytesOnchain: 0 });
    return confirmacion("CONFIRMADA", null);
  }
  try {
    const a = await anclarConReintentos(anclar, () => actualizarRevocacion(revocacionId, "ENVIADA", null));
    if (!a.confirmada) {
      await actualizarRevocacion(revocacionId, "FALLIDA", a.txId, a.codigo);
      await medir("FALLIDA", a);
      throw new ErrorApi("LEDGER_RECHAZO", `El canal invalidó la revocación (${a.codigo})`, { codigo: a.codigo });
    }
    await actualizarRevocacion(revocacionId, "CONFIRMADA", a.txId);
    await medir("CONFIRMADA", a);
    return confirmacion("CONFIRMADA", a.txId);
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    if (e instanceof ErrorTimeoutCommit) {
      await actualizarRevocacion(revocacionId, "ENVIADA", e.txId, e.message);
      await medir("TIMEOUT");
      return confirmacion("ENVIADA", e.txId);
    }
    if (e instanceof ErrorLedger && e.codigo !== "GATEWAY") {
      await actualizarRevocacion(revocacionId, "FALLIDA", null, `${e.codigo}: ${e.message}`);
      await medir("RECHAZADA");
      throw new ErrorApi("LEDGER_RECHAZO", "El ledger rechazó la revocación", { codigo: e.codigo });
    }
    console.error("[outbox] error al revocar", e);
    await medir("FALLIDA");
    throw new ErrorApi("NO_DISPONIBLE", "Ledger no disponible; la revocación quedó en la bandeja para conciliarse");
  }
}
