// Modelo de eventos académicos (F3). Tipos puros: los usan los casos de uso y las estrategias de almacenamiento.

export type TipoRegistro = "NOTA" | "ASISTENCIA";
export type Operacion = "CREAR" | "RECTIFICAR" | "REVOCAR" | "SUPRIMIR";
/** BD = línea base sin ledger (ADR-017). */
export type Estrategia = "A" | "B" | "BD";
export type EstadoOperacion = "PENDIENTE" | "ENVIADA" | "CONFIRMADA" | "FALLIDA" | "TARDIA";

/** Texto decimal exacto, p. ej. "18.5000" (DECIMAL(10,4)). Nunca un float. */
export type Decimal = string;

/**
 * Contenido académico de un evento. Usa solo identificadores seudónimos del catálogo
 * (oferta, asignatura, sección, periodo): sin nombres ni el estudiante.
 * El vínculo con la fila de origen vive en `registro.origen_id` y se borra al suprimir.
 */
export type PayloadNota = {
  tipo: "NOTA";
  anio: number;
  periodoId: string;
  ofertaId: string;
  asignaturaId: string;
  seccionId: string;
  /** Texto original de la celda ("AD", "A", "B", "C", "-"...). */
  valorFuente: string | null;
  valorNumerico: Decimal | null;
  registrada: boolean;
  nivelAgregacion: string;
  /** Texto libre del operador; vive solo en el detalle (suprimible), nunca en el ledger. */
  motivo: string | null;
};

export type PayloadAsistencia = {
  tipo: "ASISTENCIA";
  anio: number;
  seccionId: string;
  fecha: string;
  estadoCodigo: string;
  estado: string;
  motivo: string | null;
};

export type PayloadEvento = PayloadNota | PayloadAsistencia;

/** Evento tal como lo produce un caso de uso, antes de persistirlo. */
export interface EventoAcademico {
  eventoId: string;
  registroId: string;
  version: number;
  operacion: Operacion;
  prevEventoId: string | null;
  /** Rol, no persona: "operador" | "benchmark". */
  actor: string;
  /** ISO 8601 UTC con milisegundos. */
  fechaExperimental: string;
  payload: PayloadEvento;
}

/** Datos del registro de ensayo; solo se envían con la versión 1 (CREAR). */
export interface RegistroNuevo {
  registroId: string;
  tipo: TipoRegistro;
  estrategia: Estrategia;
  origenTabla: "calificaciones" | "asistencias";
  origenId: string;
}

export interface EventoNuevo {
  evento: EventoAcademico;
  registro?: RegistroNuevo;
  /** Idempotency-Key de la solicitud; identifica la operación hacia el ledger. */
  idempotencyKey: string;
  /** Corrida del benchmark (cabecera X-Corrida-Id), si la hay. */
  corridaId?: string | null;
}

/** Lo que se ancla en el ledger en modo híbrido (B): sin contenido académico. */
export interface Evidencia {
  evidenciaId: string;
  registroId: string;
  prevId: string | null;
  operacion: Operacion;
  version: number;
  /** Rol (operador | benchmark), nunca un nombre (ADR-017). */
  actorRol: string;
  /** Fecha del ledger: timestamp de la transacción en Fabric (o de inserción en el simulado). */
  fechaExperimental: string;
  /** HMAC-SHA256 (hex) de la serialización canónica del evento. */
  hmac: string;
  schemaVersion: number;
}

export type ResultadoVerificacion = "OK" | "ALTERADO" | "DETALLE_RETIRADO" | "SIN_EVIDENCIA";

export interface Verificacion {
  eventoId: string;
  resultado: ResultadoVerificacion;
  /** Qué se comparó y qué no coincidió (sin exponer la clave). */
  detalles: string[];
}

export interface Confirmacion {
  eventoId: string;
  registroId: string;
  version: number;
  operacion: Operacion;
  estadoOperacion: EstadoOperacion;
  txId: string | null;
}

export interface EventoConEvidencia {
  evento: EventoAcademico & { estadoConfirmacion: "PENDIENTE" | "CONFIRMADO" | "FALLIDO" };
  /** null si el detalle fue retirado. */
  payload: PayloadEvento | null;
  evidencia: Evidencia | null;
  operacion: { estado: EstadoOperacion; intentos: number; txId: string | null } | null;
}

export interface ResultadoSupresion {
  registroId: string;
  versionesAfectadas: number;
  detallesEliminados: number;
  clavesEliminadas: number;
}
