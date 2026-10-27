import "server-only";
import { createHash } from "node:crypto";
import type { Confirmacion, Evidencia, EventoConEvidencia, EventoNuevo, Verificacion } from "@/modules/eventos/tipos";
import { canonical, ErrorCanonico, SCHEMA_VERSION } from "@/server/crypto/canonical";
import { calcularHmac, generarClave, verificarHmac } from "@/server/crypto/hmac";
import { ErrorApi } from "@/server/http/respuestas";
import { ejecutar, esDuplicado, query } from "@/server/mysql/pool";
import { bytesFirmados } from "./firma";
import { aEventoAcademico, confirmarOperacion, insertarEvento, leerEvento } from "./persistencia-mysql";
import type { StorageStrategy } from "./tipos";

/**
 * NullLedger: estrategia híbrida (detalle y clave en MySQL, evidencia con HMAC en el "ledger")
 * donde el ledger es la tabla append-only `ledger_simulado`. Sirve para desarrollar y probar F3
 * sin Fabric. NUNCA en producción ni en el benchmark: no hay consenso, endorsement ni red.
 */
export class NullLedger implements StorageStrategy {
  readonly nombre = "NULL" as const;

  constructor() {
    // Defensa adicional a env.ts: en un `next build`, NODE_ENV queda fijado en "production".
    if (process.env.NODE_ENV === "production") throw new Error("NullLedger no puede usarse con NODE_ENV=production");
  }

  async registrar(nuevo: EventoNuevo, versionEsperada: number): Promise<Confirmacion> {
    const { evento } = nuevo;
    const bytes = bytesFirmados(evento);
    const clave = generarClave();
    const hmac = calcularHmac(clave, bytes);

    // 1) MySQL: todo en una transacción; la operación queda PENDIENTE.
    await insertarEvento(nuevo, versionEsperada, { hmac, clave, bytes: bytes.length });

    // 2) "Ledger": fuera de la transacción, como lo estará Fabric.
    const evidencia: Evidencia = {
      evidenciaId: evento.eventoId,
      registroId: evento.registroId,
      prevId: evento.prevEventoId,
      operacion: evento.operacion,
      version: evento.version,
      fechaExperimental: evento.fechaExperimental,
      hmac,
      schemaVersion: SCHEMA_VERSION,
    };
    const txId = await this.anclar(evidencia);

    // 3) Confirmación local.
    await confirmarOperacion(evento.eventoId, txId);
    return {
      eventoId: evento.eventoId, registroId: evento.registroId, version: evento.version,
      operacion: evento.operacion, estadoOperacion: "CONFIRMADA", txId,
    };
  }

  async obtener(eventoId: string): Promise<EventoConEvidencia | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    return {
      evento: aEventoAcademico(f),
      payload: f.payload,
      evidencia: await this.evidencia(eventoId),
      operacion: f.op_estado ? { estado: f.op_estado, intentos: f.op_intentos ?? 0, txId: f.op_tx_id } : null,
    };
  }

  async verificar(eventoId: string): Promise<Verificacion | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    const ev = await this.evidencia(eventoId);
    if (!ev) return { eventoId, resultado: "SIN_EVIDENCIA", detalles: ["no hay evidencia en el ledger"] };
    if (!f.payload || !f.clave) {
      return { eventoId, resultado: "DETALLE_RETIRADO", detalles: ["el detalle o la clave ya no existen en MySQL"] };
    }

    const detalles: string[] = [];
    if (ev.registroId !== f.registro_id) detalles.push("registroId no coincide con el ledger");
    if (ev.version !== f.version) detalles.push("versión no coincide con el ledger");
    if (ev.operacion !== f.operacion) detalles.push("operación no coincide con el ledger");
    if (ev.prevId !== f.prev_evento_id) detalles.push("evento previo no coincide con el ledger");
    if (f.hmac !== ev.hmac) detalles.push("el HMAC guardado en MySQL difiere del anclado");

    let hmacOk = false;
    try {
      const bytes = bytesFirmados({ ...aEventoAcademico(f), payload: f.payload });
      hmacOk = verificarHmac(f.clave, bytes, ev.hmac);
    } catch (e) {
      if (!(e instanceof ErrorCanonico)) throw e;
      detalles.push(`el detalle no es serializable: ${e.message}`);
    }
    if (!hmacOk) detalles.push("el HMAC recalculado del detalle no coincide con la evidencia");

    return detalles.length
      ? { eventoId, resultado: "ALTERADO", detalles }
      : { eventoId, resultado: "OK", detalles: ["metadatos y HMAC coinciden con el ledger"] };
  }

  async revocar(): Promise<Confirmacion> {
    throw new ErrorApi("NO_DISPONIBLE", "La revocación llega en F7");
  }

  // ----- ledger_simulado -----

  private async anclar(e: Evidencia): Promise<string> {
    const txId = createHash("sha256").update(canonical({ ...e })).digest("hex");
    try {
      await ejecutar(
        "exp",
        `INSERT INTO ledger_simulado (evidencia_id, registro_id, prev_id, operacion, version, fecha_experimental,
                                      hmac, schema_version, tx_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.evidenciaId, e.registroId, e.prevId, e.operacion, e.version, e.fechaExperimental, e.hmac, e.schemaVersion, txId],
      );
    } catch (err) {
      // Igual que en Fabric (F6.2): un id repetido con la misma evidencia es "ya confirmado".
      if (!esDuplicado(err, "PRIMARY")) throw err;
      const previa = await this.evidencia(e.evidenciaId);
      if (previa?.hmac !== e.hmac) throw err;
    }
    return txId;
  }

  private async evidencia(id: string): Promise<Evidencia | null> {
    const [f] = await query<{
      evidencia_id: string; registro_id: string; prev_id: string | null; operacion: Evidencia["operacion"];
      version: number; fecha_experimental: string; hmac: string; schema_version: number;
    }>("exp", "SELECT * FROM ledger_simulado WHERE evidencia_id = ?", [id]);
    return f
      ? {
          evidenciaId: f.evidencia_id, registroId: f.registro_id, prevId: f.prev_id, operacion: f.operacion,
          version: f.version, fechaExperimental: f.fecha_experimental, hmac: f.hmac, schemaVersion: f.schema_version,
        }
      : null;
  }
}
