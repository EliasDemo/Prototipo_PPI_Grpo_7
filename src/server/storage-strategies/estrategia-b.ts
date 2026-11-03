import "server-only";
import type { Confirmacion, Evidencia, EventoConEvidencia, EventoNuevo, Verificacion } from "@/modules/eventos/tipos";
import { ErrorCanonico, SCHEMA_VERSION } from "@/server/crypto/canonical";
import { calcularHmac, generarClave, verificarHmac } from "@/server/crypto/hmac";
import { ErrorApi } from "@/server/http/respuestas";
import { bytesFirmados } from "./firma";
import type { LedgerEvidencias } from "./ledger-evidencias";
import { registrarConOutbox } from "./outbox";
import { aEventoAcademico, leerEvento } from "./persistencia-mysql";
import type { StorageStrategy } from "./tipos";

/**
 * Estrategia B (híbrida, F5.3): el detalle y una clave HMAC aleatoria por evento quedan en MySQL;
 * al ledger solo va la evidencia (ids opacos, operación, versión, rol y HMAC).
 * Con LedgerFabric es la estrategia B del experimento; con LedgerTablaSimulada es el NullLedger.
 */
export class EstrategiaHibrida implements StorageStrategy {
  constructor(
    readonly nombre: "B" | "NULL",
    private readonly ledger: LedgerEvidencias,
  ) {}

  async registrar(nuevo: EventoNuevo, versionEsperada: number): Promise<Confirmacion> {
    const { evento } = nuevo;
    const bytes = bytesFirmados(evento);
    const clave = generarClave();
    const hmac = calcularHmac(clave, bytes);
    const evidencia: Evidencia = {
      evidenciaId: evento.eventoId,
      registroId: evento.registroId,
      prevId: evento.prevEventoId,
      operacion: evento.operacion,
      version: evento.version,
      actorRol: evento.actor,
      fechaExperimental: evento.fechaExperimental,
      hmac,
      schemaVersion: SCHEMA_VERSION,
    };
    return registrarConOutbox({
      estrategia: this.nombre,
      nuevo,
      versionEsperada,
      material: { hmac, clave, bytes: bytes.length, temporal: false },
      anclar: () => this.ledger.anclar(evidencia),
    });
  }

  async obtener(eventoId: string): Promise<EventoConEvidencia | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    return {
      evento: aEventoAcademico(f),
      payload: f.payload,
      evidencia: await this.ledger.obtener(eventoId),
      operacion: f.op_estado ? { estado: f.op_estado, intentos: f.op_intentos ?? 0, txId: f.op_tx_id } : null,
    };
  }

  async verificar(eventoId: string): Promise<Verificacion | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    const ev = await this.ledger.obtener(eventoId);
    if (!ev) return { eventoId, resultado: "SIN_EVIDENCIA", detalles: ["no hay evidencia en el ledger"] };
    if (!f.payload || !f.clave) {
      return { eventoId, resultado: "DETALLE_RETIRADO", detalles: ["el detalle o la clave ya no existen en MySQL"] };
    }

    const detalles: string[] = [];
    if (ev.registroId !== f.registro_id) detalles.push("registroId no coincide con el ledger");
    if (ev.version !== f.version) detalles.push("versión no coincide con el ledger");
    if (ev.operacion !== f.operacion) detalles.push("operación no coincide con el ledger");
    if (ev.prevId !== f.prev_evento_id) detalles.push("evento previo no coincide con el ledger");
    if (ev.actorRol !== f.actor) detalles.push("el rol del actor no coincide con el ledger");
    if (f.hmac !== ev.hmac) detalles.push("el HMAC guardado en MySQL difiere del anclado");

    let hmacOk = false;
    try {
      hmacOk = verificarHmac(f.clave, bytesFirmados({ ...aEventoAcademico(f), payload: f.payload }), ev.hmac);
    } catch (e) {
      if (!(e instanceof ErrorCanonico)) throw e;
      detalles.push(`el detalle no es serializable: ${e.message}`);
    }
    if (!hmacOk) detalles.push("el HMAC recalculado del detalle no coincide con la evidencia");

    return detalles.length
      ? { eventoId, resultado: "ALTERADO", detalles }
      : { eventoId, resultado: "OK", detalles: ["metadatos, rol y HMAC coinciden con el ledger"] };
  }

  async revocar(): Promise<Confirmacion> {
    throw new ErrorApi("NO_DISPONIBLE", "La revocación llega en F7");
  }
}
