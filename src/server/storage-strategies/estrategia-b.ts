import "server-only";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Confirmacion, EventoAcademico, Evidencia, EventoConEvidencia, EventoNuevo, PayloadEvento, ResultadoSupresion, Verificacion } from "@/modules/eventos/tipos";
import { ErrorCanonico, SCHEMA_VERSION } from "@/server/crypto/canonical";
import { calcularHmac, generarClave, verificarHmac } from "@/server/crypto/hmac";
import { bytesFirmados } from "./firma";
import { jsonEvidencia, type LedgerEvidencias } from "./ledger-evidencias";
import { anclarOperacion, registrarConOutbox, revocarConOutbox } from "./outbox";
import { aEventoAcademico, insertarSupresion, leerEvento } from "./persistencia-mysql";
import type { SolicitudRevocacion, SolicitudSupresion, StorageStrategy } from "./tipos";

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
      material: { hmac, clave, bytes: bytes.length, temporal: false, mensaje: { funcion: "RegistrarEvidencia", json: jsonEvidencia(evidencia) } },
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

  async revocar(s: SolicitudRevocacion): Promise<Confirmacion> {
    return revocarConOutbox(this.nombre, s, () => this.ledger.revocar(s.evidenciaId, s.motivoCodigo));
  }

  /**
   * F7.2: borra detalle y claves de todas las versiones y ancla SUPRIMIR, sin datos personales.
   * Su HMAC usa una clave de un solo uso que no se guarda: es solo un valor opaco de la cadena.
   */
  async suprimir(s: SolicitudSupresion): Promise<ResultadoSupresion> {
    const evento: EventoAcademico = {
      eventoId: randomUUID(), registroId: s.registroId, version: s.version + 1, operacion: "SUPRIMIR",
      prevEventoId: s.prevEventoId, actor: s.actor, fechaExperimental: new Date().toISOString(),
      payload: { retirado: true } as unknown as PayloadEvento,
    };
    const hmac = calcularHmac(generarClave(), bytesFirmados(evento));
    const evidencia: Evidencia = {
      evidenciaId: evento.eventoId, registroId: evento.registroId, prevId: evento.prevEventoId, operacion: "SUPRIMIR",
      version: evento.version, actorRol: evento.actor, fechaExperimental: evento.fechaExperimental, hmac, schemaVersion: SCHEMA_VERSION,
    };
    const { opId, resultado } = await insertarSupresion(evento, {
      hmac, idempotencyKey: s.idempotencyKey, corridaId: s.corridaId,
      mensaje: { funcion: "RegistrarEvidencia", json: jsonEvidencia(evidencia) },
    });
    const confirmacion = await anclarOperacion({
      opId, estrategia: this.nombre, evento, corridaId: s.corridaId, inicio: performance.now(), tMysql: 0, bytesOffchain: 0,
      anclar: () => this.ledger.anclar(evidencia),
    });
    return { ...resultado, confirmacion };
  }
}
