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

  /** F7. Agrega la revocación sobre la versión vigente, sin borrar nada. */
  revocar(s: SolicitudRevocacion): Promise<Confirmacion>;

  /** F7, solo B (y NullLedger, que tiene su semántica). */
  suprimir?(s: SolicitudSupresion): Promise<ResultadoSupresion>;
}

export interface SolicitudRevocacion {
  registroId: string;
  evidenciaId: string;
  version: number;
  motivoCodigo: string;
  actor: string;
  idempotencyKey: string;
  corridaId: string | null;
}

export interface SolicitudSupresion {
  registroId: string;
  /** Versión vigente y su evento: SUPRIMIR se encadena sobre ellos. */
  version: number;
  prevEventoId: string;
  actor: string;
  idempotencyKey: string;
  corridaId: string | null;
}
