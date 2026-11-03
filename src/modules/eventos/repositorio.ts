import "server-only";
import { query } from "@/server/mysql/pool";
import { isoDesdeMysql } from "@/server/storage-strategies/persistencia-mysql";
import type { CuerpoCrear } from "./esquemas";
import type { Operacion, PayloadAsistencia, PayloadEvento, PayloadNota, TipoRegistro } from "./tipos";

// ---------- Origen (pool ro: solo lectura) ----------

/** Payload de la fila de origen, sin estudiante ni nombres. null si no existe. */
export async function payloadDesdeOrigen(c: CuerpoCrear): Promise<PayloadEvento | null> {
  if (c.tipo === "NOTA") {
    const [f] = await query<{
      anio: number; periodo_id: string; oferta_id: string; asignatura_id: string; seccion_id: string;
      valor_fuente: string | null; valor_numerico: string | null; registrada: boolean; nivel_agregacion: string;
    }>(
      "ro",
      // CAST conserva el texto exacto del DECIMAL(10,4) (sin pasar por float).
      `SELECT c.anio, c.periodo_id, c.oferta_id, o.asignatura_id, o.seccion_id, c.valor_fuente,
              CAST(c.valor_numerico AS CHAR) valor_numerico, c.registrada, c.nivel_agregacion
         FROM calificaciones c JOIN ofertas o ON o.oferta_id = c.oferta_id
        WHERE c.calificacion_id = ?`,
      [c.origenId],
    );
    if (!f) return null;
    const p: PayloadNota = {
      tipo: "NOTA", anio: f.anio, periodoId: f.periodo_id, ofertaId: f.oferta_id, asignaturaId: f.asignatura_id,
      seccionId: f.seccion_id, valorFuente: f.valor_fuente, valorNumerico: f.valor_numerico, registrada: f.registrada,
      nivelAgregacion: f.nivel_agregacion, motivo: null,
    };
    return p;
  }
  const [f] = await query<{ anio: number; seccion_id: string; fecha: string; estado_codigo: string; estado: string }>(
    "ro",
    "SELECT anio, seccion_id, fecha, estado_codigo, estado FROM asistencias WHERE asistencia_id = ?",
    [c.origenId],
  );
  if (!f) return null;
  const p: PayloadAsistencia = {
    tipo: "ASISTENCIA", anio: f.anio, seccionId: f.seccion_id, fecha: f.fecha, estadoCodigo: f.estado_codigo, estado: f.estado, motivo: null,
  };
  return p;
}

// ---------- Base experimental (pool exp) ----------

export interface FilaRegistro {
  registro_id: string;
  tipo: TipoRegistro;
  estrategia: "A" | "B" | "BD";
  origen_tabla: string | null;
  origen_id: string | null;
  estado_vigencia: "VIGENTE" | "REVOCADO";
  estado_detalle: "PRESENTE" | "RETIRADO";
  version_actual: number;
  creado_en: string;
}

export async function leerRegistro(registroId: string): Promise<FilaRegistro | null> {
  const [f] = await query<FilaRegistro>("exp", "SELECT * FROM registro WHERE registro_id = ?", [registroId]);
  return f ?? null;
}

export async function eventoEnVersion(registroId: string, version: number) {
  const [f] = await query<{ evento_id: string; payload: PayloadEvento | null }>(
    "exp",
    `SELECT e.evento_id, d.payload FROM evento e LEFT JOIN evento_detalle d ON d.evento_id = e.evento_id
      WHERE e.registro_id = ? AND e.version = ?`,
    [registroId, version],
  );
  return f ?? null;
}

export async function leerRevocacion(registroId: string) {
  const [f] = await query<{ evidencia_id: string; motivo_codigo: string; estado: string; tx_id: string | null; creada_en: string }>(
    "exp",
    "SELECT evidencia_id, motivo_codigo, estado, tx_id, creada_en FROM revocacion WHERE registro_id = ?",
    [registroId],
  );
  return f ? { evidenciaId: f.evidencia_id, motivoCodigo: f.motivo_codigo, estado: f.estado, txId: f.tx_id, fecha: isoDesdeMysql(f.creada_en) } : null;
}

export interface EslabonCadena {
  eventoId: string;
  version: number;
  operacion: Operacion;
  prevEventoId: string | null;
  actor: string;
  fechaExperimental: string;
  estadoConfirmacion: string;
  estadoOperacion: string | null;
  detallePresente: boolean;
}

export async function cadenaDeVersiones(registroId: string): Promise<EslabonCadena[]> {
  const filas = await query<{
    evento_id: string; version: number; operacion: Operacion; prev_evento_id: string | null; actor: string;
    fecha_experimental: string; estado_confirmacion: string; op_estado: string | null; detalle: number;
  }>(
    "exp",
    `SELECT e.evento_id, e.version, e.operacion, e.prev_evento_id, e.actor, e.fecha_experimental,
            e.estado_confirmacion, o.estado op_estado, (d.evento_id IS NOT NULL) detalle
       FROM evento e
       LEFT JOIN operacion o ON o.evento_id = e.evento_id
       LEFT JOIN evento_detalle d ON d.evento_id = e.evento_id
      WHERE e.registro_id = ?
      ORDER BY e.version`,
    [registroId],
  );
  return filas.map((f) => ({
    eventoId: f.evento_id, version: f.version, operacion: f.operacion, prevEventoId: f.prev_evento_id, actor: f.actor,
    fechaExperimental: isoDesdeMysql(f.fecha_experimental), estadoConfirmacion: f.estado_confirmacion,
    estadoOperacion: f.op_estado, detallePresente: Number(f.detalle) === 1,
  }));
}
