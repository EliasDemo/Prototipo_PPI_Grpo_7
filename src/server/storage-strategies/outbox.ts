import "server-only";
import { performance } from "node:perf_hooks";
import type { Confirmacion, EventoNuevo } from "@/modules/eventos/tipos";
import { ErrorLedger, ErrorTimeoutCommit } from "@/server/fabric/gateway";
import { ErrorApi } from "@/server/http/respuestas";
import {
  anotarTxPendiente,
  confirmarOperacion,
  insertarEvento,
  marcarEnviada,
  marcarFallida,
  registrarMedicion,
  type MaterialEvento,
  type Medicion,
} from "./persistencia-mysql";

// Bandeja transaccional (outbox) común a todas las estrategias (ADR-015, F5/F6):
//   1) MySQL: cambio académico + operación PENDIENTE en UNA transacción;
//   2) la operación pasa a ENVIADA y se ancla en el ledger (salvo BD);
//   3) CONFIRMADA si el commit es VALID; FALLIDA si el ledger la rechaza o invalida;
//      si el commit no responde a tiempo queda ENVIADA con su txId para la conciliación (F6).
// Cada operación deja una fila en `medicion` con los tiempos de cada etapa (F5.7).

export interface Anclaje {
  txId: string;
  confirmada: boolean;
  codigo: string;
  msSubmit: number;
  msCommit: number;
  bytesOnchain: number;
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
  const t0 = performance.now();
  const { opId } = await insertarEvento(f.nuevo, f.versionEsperada, f.material);
  const tMysql = performance.now() - t0;

  const confirmacion = (estadoOperacion: Confirmacion["estadoOperacion"], txId: string | null): Confirmacion => ({
    eventoId: evento.eventoId, registroId: evento.registroId, version: evento.version,
    operacion: evento.operacion, estadoOperacion, txId,
  });
  const medir = (resultado: Medicion["resultado"], a?: Partial<Anclaje>) =>
    registrarMedicion({
      opId, corridaId: corridaId ?? null, estrategia: f.estrategia, operacion: evento.operacion, resultado,
      tMysqlMs: tMysql, tFabricSubmitMs: a?.msSubmit ?? null, tFabricCommitMs: a?.msCommit ?? null,
      tTotalMs: performance.now() - t0, bytesOnchain: a?.bytesOnchain ?? null,
      bytesOffchain: f.material.temporal ? 0 : f.material.bytes,
    });

  if (!f.anclar) {
    await confirmarOperacion(evento.eventoId, null, "SIN_LEDGER");
    await medir("CONFIRMADA", { bytesOnchain: 0 });
    return confirmacion("CONFIRMADA", null);
  }

  await marcarEnviada(evento.eventoId);
  let a: Anclaje;
  try {
    a = await f.anclar();
  } catch (e) {
    if (e instanceof ErrorTimeoutCommit) {
      await anotarTxPendiente(evento.eventoId, e.txId, e.message);
      await medir("TIMEOUT");
      return confirmacion("ENVIADA", e.txId);
    }
    if (e instanceof ErrorLedger) {
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

  if (!a.confirmada) {
    await marcarFallida(evento.eventoId, a.codigo, "transacción invalidada por el canal", a.txId);
    await medir("FALLIDA", a);
    throw new ErrorApi("LEDGER_RECHAZO", `El canal invalidó la transacción (${a.codigo})`, {
      codigo: a.codigo, txId: a.txId, eventoId: evento.eventoId,
    });
  }

  await confirmarOperacion(evento.eventoId, a.txId, a.codigo);
  await f.alConfirmar?.();
  await medir("CONFIRMADA", a);
  return confirmacion("CONFIRMADA", a.txId);
}
