import "server-only";
import { query } from "@/server/mysql/pool";

// Cobertura del conjunto de origen: conteos, años, fuentes y diferencias de control.

const TABLAS = [
  "ciclos", "estudiantes", "secciones", "asignaturas", "periodos", "ofertas",
  "fuentes", "matriculas", "asistencias", "calificaciones", "controles",
] as const;

export interface ResumenDatos {
  conteos: Record<(typeof TABLAS)[number], number> & { calificacionesRegistradas: number };
  anios: { anio: number; nombre: string; matriculas: number; asistencias: number; calificaciones: number; calificacionesRegistradas: number }[];
  fuentes: { fuenteId: string; archivo: string; tipo: string; anio: number; filasFuente: number; sha256: string; fechaMin: string | null; fechaMax: string | null }[];
  diferencias: { controlId: number; fuenteId: string; anio: number; grupo: string; tipo: string; estadoCodigo: string | null; extraido: number; totalFuente: number; diferencia: number }[];
}

export async function resumenDatos(): Promise<ResumenDatos> {
  // TABLAS es una lista fija del código: interpolar el nombre es seguro.
  const conteoSql = TABLAS.map((t) => `(SELECT COUNT(*) FROM \`${t}\`) AS \`${t}\``).join(", ");
  const [[conteos], anios, fuentes, diferencias] = await Promise.all([
    query<Record<string, number>>(
      "ro",
      `SELECT ${conteoSql}, (SELECT COUNT(*) FROM calificaciones WHERE registrada = 1) AS calificacionesRegistradas`,
    ),
    query<{ anio: number; nombre: string; matriculas: number; asistencias: number; calificaciones: number; registradas: number }>(
      "ro",
      `SELECT c.anio, c.nombre,
              (SELECT COUNT(*) FROM matriculas m WHERE m.anio = c.anio) matriculas,
              (SELECT COUNT(*) FROM asistencias a WHERE a.anio = c.anio) asistencias,
              (SELECT COUNT(*) FROM calificaciones k WHERE k.anio = c.anio) calificaciones,
              (SELECT COUNT(*) FROM calificaciones k WHERE k.anio = c.anio AND k.registrada = 1) registradas
         FROM ciclos c ORDER BY c.anio`,
    ),
    query<{ fuente_id: string; archivo: string; tipo: string; anio: number; filas_fuente: number; sha256: string; fecha_min: string | null; fecha_max: string | null }>(
      "ro",
      "SELECT fuente_id, archivo, tipo, anio, filas_fuente, sha256, fecha_min, fecha_max FROM fuentes ORDER BY fuente_id",
    ),
    query<{ control_id: number; fuente_id: string; anio: number; grupo: string; tipo: string; estado_codigo: string | null; extraido: number; total_fuente: number; diferencia: number }>(
      "ro",
      `SELECT control_id, fuente_id, anio, grupo, tipo, estado_codigo, extraido, total_fuente, diferencia
         FROM controles WHERE coincide = 0 ORDER BY control_id`,
    ),
  ]);

  return {
    conteos: Object.fromEntries(Object.entries(conteos ?? {}).map(([k, v]) => [k, Number(v)])) as ResumenDatos["conteos"],
    anios: anios.map((r) => ({
      anio: r.anio, nombre: r.nombre, matriculas: Number(r.matriculas), asistencias: Number(r.asistencias),
      calificaciones: Number(r.calificaciones), calificacionesRegistradas: Number(r.registradas),
    })),
    fuentes: fuentes.map((r) => ({
      fuenteId: r.fuente_id, archivo: r.archivo, tipo: r.tipo, anio: r.anio, filasFuente: r.filas_fuente,
      sha256: r.sha256, fechaMin: r.fecha_min, fechaMax: r.fecha_max,
    })),
    diferencias: diferencias.map((r) => ({
      controlId: r.control_id, fuenteId: r.fuente_id, anio: r.anio, grupo: r.grupo, tipo: r.tipo,
      estadoCodigo: r.estado_codigo, extraido: r.extraido, totalFuente: r.total_fuente, diferencia: r.diferencia,
    })),
  };
}
