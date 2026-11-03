import type {
  Confirmacion,
  EventoConEvidencia,
  EventoNuevo,
  ResultadoSupresion,
  Verificacion,
} from "@/modules/eventos/tipos";

/**
 * Estrategia de almacenamiento (PLAN_DESARROLLO.md, sección 3).
 * BD (línea base sin ledger), A (referencia) y B (híbrida); NullLedger solo para desarrollo y pruebas.
 */
export interface StorageStrategy {
  readonly nombre: "A" | "B" | "BD" | "NULL";

  /**
   * Persiste el evento en MySQL y lo ancla en el ledger.
   * `versionEsperada` es la versión vigente del registro (0 al crear). Si no coincide, lanza
   * ErrorApi VERSION_DESACTUALIZADA.
   */
  registrar(evento: EventoNuevo, versionEsperada: number): Promise<Confirmacion>;

  /** null si el evento no existe. */
  obtener(eventoId: string): Promise<EventoConEvidencia | null>;

  /** null si el evento no existe. */
  verificar(eventoId: string): Promise<Verificacion | null>;

  /** F7. */
  revocar(eventoId: string, motivo: string): Promise<Confirmacion>;

  /** F7, solo B. */
  suprimir?(registroId: string): Promise<ResultadoSupresion>;
}
