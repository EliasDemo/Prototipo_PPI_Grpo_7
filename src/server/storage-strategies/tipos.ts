import type {
  Confirmacion,
  EventoConEvidencia,
  EventoNuevo,
  ResultadoSupresion,
  Verificacion,
} from "@/modules/eventos/tipos";

/**
 * Estrategia de almacenamiento (PLAN_DESARROLLO.md, sección 3).
 * A (referencia) y B (híbrida) llegan en F5; en F3 solo existe NullLedger.
 */
export interface StorageStrategy {
  readonly nombre: "A" | "B" | "NULL";

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
