import "server-only";
import type { Confirmacion, EventoConEvidencia, EventoNuevo, Verificacion } from "@/modules/eventos/tipos";
import { calcularHmac, generarClave } from "@/server/crypto/hmac";
import { bytesFirmados } from "./firma";
import { registrarConOutbox, revocarConOutbox } from "./outbox";
import { aEventoAcademico, leerEvento } from "./persistencia-mysql";
import type { SolicitudRevocacion, StorageStrategy } from "./tipos";

/**
 * Línea base BD (ADR-017, RQ3): exactamente el mismo trabajo en MySQL que la estrategia B
 * (detalle, clave, HMAC y bandeja transaccional), pero sin anclar en ningún ledger.
 * La diferencia de tiempos con A y B es la sobrecarga del anclaje.
 */
export class EstrategiaBD implements StorageStrategy {
  readonly nombre = "BD" as const;

  async registrar(nuevo: EventoNuevo, versionEsperada: number): Promise<Confirmacion> {
    const bytes = bytesFirmados(nuevo.evento);
    const clave = generarClave();
    return registrarConOutbox({
      estrategia: "BD",
      nuevo,
      versionEsperada,
      material: { hmac: calcularHmac(clave, bytes), clave, bytes: bytes.length, temporal: false, mensaje: null },
      anclar: null,
    });
  }

  async obtener(eventoId: string): Promise<EventoConEvidencia | null> {
    const f = await leerEvento(eventoId);
    if (!f) return null;
    return {
      evento: aEventoAcademico(f),
      payload: f.payload,
      evidencia: null,
      operacion: f.op_estado ? { estado: f.op_estado, intentos: f.op_intentos ?? 0, txId: f.op_tx_id } : null,
    };
  }

  async verificar(eventoId: string): Promise<Verificacion | null> {
    if (!(await leerEvento(eventoId))) return null;
    return { eventoId, resultado: "SIN_EVIDENCIA", detalles: ["estrategia BD (línea base): no hay ledger contra el cual verificar"] };
  }

  async revocar(s: SolicitudRevocacion): Promise<Confirmacion> {
    return revocarConOutbox("BD", s, null);
  }
}
