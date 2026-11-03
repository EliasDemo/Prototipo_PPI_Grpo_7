import "server-only";
import { createHash } from "node:crypto";
import type { Confirmacion, EventoConEvidencia, EventoNuevo, PayloadEvento, Verificacion } from "@/modules/eventos/tipos";
import { canonical, SCHEMA_VERSION } from "@/server/crypto/canonical";
import { consultar, enviar, ErrorLedger } from "@/server/fabric/gateway";
import { ErrorApi } from "@/server/http/respuestas";
import { bytesFirmados } from "./firma";
import { registrarConOutbox } from "./outbox";
import { aEventoAcademico, borrarDetalleTemporal, leerEvento } from "./persistencia-mysql";
import { sintetizar } from "./sintetico";
import type { StorageStrategy } from "./tipos";

// Estrategia A (referencia, F5.2): el evento completo vive en el ledger. En el experimento, lo que
// se ancla es un evento SINTÉTICO no identificable con la misma estructura y tamaño que el real
// (ADR-015). El detalle real queda en MySQL solo como temporal y se borra al confirmarse.
// En evento.hmac se guarda un compromiso SHA-256 del contenido anclado para poder verificarlo.

const sha256 = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

interface RegistroA {
  tipo: "EVENTO" | "EVIDENCIA";
  evidenciaId: string;
  registroOpacoId: string;
  prevEvidenciaId: string | null;
  version: number;
  operacion: Confirmacion["operacion"];
  actorRol: string;
  schemaVersion: number;
  contenido?: Record<string, unknown>;
  fechaTx: string;
}

async function leerLedger(id: string): Promise<RegistroA | null> {
  try {
    const r = JSON.parse(await consultar("ObtenerEvidencia", id)) as RegistroA;
    return r.tipo === "EVENTO" ? r : null;
  } catch (e) {
    if (e instanceof ErrorLedger && e.codigo === "NO_ENCONTRADO") return null;
    throw e;
  }
}

export class EstrategiaA implements StorageStrategy {
  readonly nombre = "A" as const;

  async registrar(nuevo: EventoNuevo, versionEsperada: number): Promise<Confirmacion> {
    const { evento } = nuevo;
    const contenido = sintetizar(evento.payload);
    const json = JSON.stringify({
      evidenciaId: evento.eventoId,
      registroOpacoId: evento.registroId,
      prevEvidenciaId: evento.prevEventoId,
      version: evento.version,
      operacion: evento.operacion,
      actorRol: evento.actor,
      schemaVersion: SCHEMA_VERSION,
      contenido,
    });
    return registrarConOutbox({
      estrategia: "A",
      nuevo,
      versionEsperada,
      material: { hmac: sha256(contenido), clave: null, bytes: bytesFirmados(evento).length, temporal: true },
      anclar: async () => {
        const r = await enviar("RegistrarEventoCompleto", json);
        return { txId: r.txId, confirmada: r.confirmada, codigo: r.codigo, msSubmit: r.msSubmit, msCommit: r.msCommit, bytesOnchain: Buffer.byteLength(json) };
      },
      alConfirmar: () => borrarDetalleTemporal(evento.eventoId),
    });
  }

  async obtener(eventoId: string): Promise<EventoConEvidencia | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    const r = await leerLedger(eventoId);
    // Tras confirmarse, el sistema de registro del modo A es el ledger: su contenido (sintético).
    const payload = (f.payload ?? (r?.contenido as PayloadEvento | undefined) ?? null) as PayloadEvento | null;
    return {
      evento: aEventoAcademico({ ...f, payload }),
      payload,
      evidencia: r && {
        evidenciaId: r.evidenciaId, registroId: r.registroOpacoId, prevId: r.prevEvidenciaId, operacion: r.operacion,
        version: r.version, actorRol: r.actorRol, fechaExperimental: r.fechaTx, hmac: sha256(r.contenido), schemaVersion: r.schemaVersion,
      },
      operacion: f.op_estado ? { estado: f.op_estado, intentos: f.op_intentos ?? 0, txId: f.op_tx_id } : null,
    };
  }

  async verificar(eventoId: string): Promise<Verificacion | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    const r = await leerLedger(eventoId);
    if (!r) return { eventoId, resultado: "SIN_EVIDENCIA", detalles: ["el evento no está en el ledger"] };

    const detalles: string[] = [];
    if (r.registroOpacoId !== f.registro_id) detalles.push("registroId no coincide con el ledger");
    if (r.version !== f.version) detalles.push("versión no coincide con el ledger");
    if (r.operacion !== f.operacion) detalles.push("operación no coincide con el ledger");
    if (r.prevEvidenciaId !== f.prev_evento_id) detalles.push("evento previo no coincide con el ledger");
    if (r.actorRol !== f.actor) detalles.push("el rol del actor no coincide con el ledger");
    if (!f.hmac || sha256(r.contenido) !== f.hmac) detalles.push("el contenido del ledger no coincide con el compromiso guardado en MySQL");

    return detalles.length
      ? { eventoId, resultado: "ALTERADO", detalles }
      : { eventoId, resultado: "OK", detalles: ["metadatos, rol y compromiso del contenido coinciden con el ledger"] };
  }

  async revocar(): Promise<Confirmacion> {
    throw new ErrorApi("NO_DISPONIBLE", "La revocación llega en F7");
  }
}
