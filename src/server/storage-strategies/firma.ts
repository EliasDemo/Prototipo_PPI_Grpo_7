import type { EventoAcademico } from "@/modules/eventos/tipos";
import { serializarVersionado } from "@/server/crypto/canonical";

/**
 * Bytes que se firman con HMAC. Atan el contenido académico (payload) a la identidad
 * del evento y a su posición en la cadena (versión y evento previo).
 * Actor y fecha no entran: el actor es un rol y la fecha queda en la evidencia del ledger.
 */
export function bytesFirmados(e: Pick<EventoAcademico, "eventoId" | "registroId" | "version" | "operacion" | "prevEventoId" | "payload">): Buffer {
  return serializarVersionado({
    eventoId: e.eventoId,
    registroId: e.registroId,
    version: e.version,
    operacion: e.operacion,
    prevEventoId: e.prevEventoId,
    payload: e.payload,
  });
}
