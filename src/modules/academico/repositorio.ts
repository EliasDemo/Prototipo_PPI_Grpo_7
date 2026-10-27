import "server-only";
import { query, type Parametro } from "@/server/mysql/pool";
import { offset } from "@/shared/validation/paginacion";
import type {
  Asistencia,
  Calificacion,
  Catalogo,
  EstudianteResumen,
  FiltrosAsistencias,
  FiltrosCalificaciones,
  FiltrosCatalogo,
  FiltrosEstudiantes,
  Matricula,
} from "./esquemas";

// Solo lectura del origen (pool `ro`, usuario app_ro). Todo valor del usuario va como parámetro `?`.

/** Arma un WHERE a partir de condiciones opcionales; las condiciones son texto fijo, no datos del usuario. */
function donde(condiciones: [string, Parametro | undefined][]) {
  const activas = condiciones.filter(([, v]) => v !== undefined) as [string, Parametro][];
  return {
    sql: activas.length ? `WHERE ${activas.map(([c]) => c).join(" AND ")}` : "",
    params: activas.map(([, v]) => v),
  };
}

const total = async (sql: string, params: Parametro[]) =>
  Number((await query<{ n: number }>("ro", sql, params))[0]?.n ?? 0);

// ---------- Estudiantes ----------

export async function listarEstudiantes(f: FiltrosEstudiantes) {
  // El filtro se aplica sobre matrículas; el listado muestra todas las matrículas del estudiante.
  const w = donde([
    ["m.anio = ?", f.anio],
    ["m.seccion_id = ?", f.seccion],
  ]);
  const filtro = w.sql
    ? `WHERE EXISTS (SELECT 1 FROM matriculas m ${w.sql} AND m.estudiante_id = e.estudiante_id)`
    : "";

  const [n, filas] = await Promise.all([
    total(`SELECT COUNT(*) n FROM estudiantes e ${filtro}`, w.params),
    query<{ estudiante_id: string; matriculas: number; anios: string | null }>(
      "ro",
      `SELECT p.estudiante_id, COUNT(mm.matricula_id) matriculas,
              GROUP_CONCAT(DISTINCT mm.anio ORDER BY mm.anio) anios
         FROM (SELECT e.estudiante_id FROM estudiantes e ${filtro}
                ORDER BY e.estudiante_id LIMIT ? OFFSET ?) p
         LEFT JOIN matriculas mm ON mm.estudiante_id = p.estudiante_id
        GROUP BY p.estudiante_id
        ORDER BY p.estudiante_id`,
      [...w.params, f.pageSize, offset(f)],
    ),
  ]);

  const data: EstudianteResumen[] = filas.map((r) => ({
    estudianteId: r.estudiante_id,
    matriculas: Number(r.matriculas),
    anios: r.anios ? r.anios.split(",").map(Number) : [],
  }));
  return { data, total: n };
}

export async function existeEstudiante(id: string) {
  return (await total("SELECT COUNT(*) n FROM estudiantes WHERE estudiante_id = ?", [id])) > 0;
}

export async function matriculasDeEstudiante(id: string): Promise<Matricula[]> {
  const filas = await query<{
    matricula_id: string; anio: number; estado: string | null; seccion_id: string;
    nivel: string | null; grado: string; seccion: string; fuente_id: string; hoja_fuente: string; fila_fuente: number;
  }>(
    "ro",
    `SELECT m.matricula_id, m.anio, m.estado, s.seccion_id, s.nivel, s.grado, s.seccion,
            m.fuente_id, m.hoja_fuente, m.fila_fuente
       FROM matriculas m JOIN secciones s ON s.seccion_id = m.seccion_id
      WHERE m.estudiante_id = ?
      ORDER BY m.anio, m.matricula_id`,
    [id],
  );
  return filas.map((r) => ({
    matriculaId: r.matricula_id,
    anio: r.anio,
    estado: r.estado,
    seccion: { seccionId: r.seccion_id, nivel: r.nivel, grado: r.grado, seccion: r.seccion },
    procedencia: { fuenteId: r.fuente_id, hoja: r.hoja_fuente, fila: r.fila_fuente },
  }));
}

// ---------- Calificaciones ----------

export async function listarCalificaciones(f: FiltrosCalificaciones) {
  const w = donde([
    ["c.anio = ?", f.anio],
    ["o.seccion_id = ?", f.seccion],
    ["o.asignatura_id = ?", f.asignatura],
    ["c.periodo_id = ?", f.periodo],
    ["c.registrada = ?", f.registrada],
  ]);
  const necesitaOferta = f.seccion !== undefined || f.asignatura !== undefined;

  const [n, filas] = await Promise.all([
    total(
      `SELECT COUNT(*) n FROM calificaciones c
         ${necesitaOferta ? "JOIN ofertas o ON o.oferta_id = c.oferta_id" : ""} ${w.sql}`,
      w.params,
    ),
    query<{
      calificacion_id: string; estudiante_id: string; anio: number; periodo_id: string; oferta_id: string;
      seccion_id: string; asignatura_id: string; asignatura: string; valor_fuente: string | null;
      valor_numerico: number | null; registrada: boolean; nivel_agregacion: string;
      fuente_id: string; hoja_fuente: string; fila_fuente: number; columna_fuente: number;
    }>(
      "ro",
      `SELECT c.calificacion_id, c.estudiante_id, c.anio, c.periodo_id, c.oferta_id,
              o.seccion_id, o.asignatura_id, a.nombre asignatura,
              c.valor_fuente, c.valor_numerico, c.registrada, c.nivel_agregacion,
              c.fuente_id, c.hoja_fuente, c.fila_fuente, c.columna_fuente
         FROM calificaciones c
         JOIN ofertas o ON o.oferta_id = c.oferta_id
         JOIN asignaturas a ON a.asignatura_id = o.asignatura_id
         ${w.sql}
        ORDER BY c.calificacion_id
        LIMIT ? OFFSET ?`,
      [...w.params, f.pageSize, offset(f)],
    ),
  ]);

  const data: Calificacion[] = filas.map((r) => ({
    calificacionId: r.calificacion_id,
    estudianteId: r.estudiante_id,
    anio: r.anio,
    periodoId: r.periodo_id,
    ofertaId: r.oferta_id,
    seccionId: r.seccion_id,
    asignaturaId: r.asignatura_id,
    asignatura: r.asignatura,
    valorFuente: r.valor_fuente,
    valorNumerico: r.valor_numerico,
    registrada: r.registrada,
    nivelAgregacion: r.nivel_agregacion,
    procedencia: { fuenteId: r.fuente_id, hoja: r.hoja_fuente, fila: r.fila_fuente, columna: r.columna_fuente },
  }));
  return { data, total: n };
}

// ---------- Asistencias ----------

export async function listarAsistencias(f: FiltrosAsistencias) {
  const w = donde([
    ["a.anio = ?", f.anio],
    ["a.seccion_id = ?", f.seccion],
    ["a.fecha >= ?", f.desde],
    ["a.fecha <= ?", f.hasta],
  ]);

  const [n, filas] = await Promise.all([
    total(`SELECT COUNT(*) n FROM asistencias a ${w.sql}`, w.params),
    // Orden (anio, fecha, asistencia_id) = índice idx_asistencia_fecha + PK: sin filesort.
    // Paginación diferida: se ubican las PK en el índice y luego se leen las filas completas.
    query<{
      asistencia_id: string; estudiante_id: string; seccion_id: string; anio: number; fecha: string;
      estado_codigo: string; estado: string; fuente_id: string; hoja_fuente: string; fila_fuente: number; columna_fuente: number;
    }>(
      "ro",
      `SELECT a.asistencia_id, a.estudiante_id, a.seccion_id, a.anio, a.fecha, a.estado_codigo, a.estado,
              a.fuente_id, a.hoja_fuente, a.fila_fuente, a.columna_fuente
         FROM (SELECT a.asistencia_id FROM asistencias a ${w.sql}
                ORDER BY a.anio, a.fecha, a.asistencia_id LIMIT ? OFFSET ?) p
         JOIN asistencias a ON a.asistencia_id = p.asistencia_id
        ORDER BY a.anio, a.fecha, a.asistencia_id`,
      [...w.params, f.pageSize, offset(f)],
    ),
  ]);

  const data: Asistencia[] = filas.map((r) => ({
    asistenciaId: r.asistencia_id,
    estudianteId: r.estudiante_id,
    seccionId: r.seccion_id,
    anio: r.anio,
    fecha: r.fecha,
    estadoCodigo: r.estado_codigo,
    estado: r.estado,
    procedencia: { fuenteId: r.fuente_id, hoja: r.hoja_fuente, fila: r.fila_fuente, columna: r.columna_fuente },
  }));
  return { data, total: n };
}

// ---------- Catálogo ----------

export async function catalogo(f: FiltrosCatalogo): Promise<Catalogo> {
  const porAnio = donde([["anio = ?", f.anio]]);
  const [asignaturas, ofertas, periodos, secciones] = await Promise.all([
    query<{ asignatura_id: string; nombre: string; nombre_fuente: string; espacio_inicial_fuente: boolean }>(
      "ro",
      f.anio === undefined
        ? "SELECT asignatura_id, nombre, nombre_fuente, espacio_inicial_fuente FROM asignaturas ORDER BY nombre"
        : `SELECT asignatura_id, nombre, nombre_fuente, espacio_inicial_fuente FROM asignaturas
            WHERE asignatura_id IN (SELECT asignatura_id FROM ofertas WHERE anio = ?) ORDER BY nombre`,
      porAnio.params,
    ),
    query<{ oferta_id: string; seccion_id: string; asignatura_id: string; anio: number }>(
      "ro",
      `SELECT oferta_id, seccion_id, asignatura_id, anio FROM ofertas ${porAnio.sql} ORDER BY anio, seccion_id, asignatura_id`,
      porAnio.params,
    ),
    query<{ periodo_id: string; anio: number; numero: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null }>(
      "ro",
      `SELECT periodo_id, anio, numero, nombre, fecha_inicio, fecha_fin FROM periodos ${porAnio.sql} ORDER BY anio, numero`,
      porAnio.params,
    ),
    query<{ seccion_id: string; anio: number; nivel: string | null; grado: string; seccion: string; grado_fuente: string }>(
      "ro",
      `SELECT seccion_id, anio, nivel, grado, seccion, grado_fuente FROM secciones ${porAnio.sql}
        ORDER BY anio, nivel, grado, seccion`,
      porAnio.params,
    ),
  ]);
  return {
    asignaturas: asignaturas.map((r) => ({
      asignaturaId: r.asignatura_id, nombre: r.nombre, nombreFuente: r.nombre_fuente, espacioInicialFuente: r.espacio_inicial_fuente,
    })),
    ofertas: ofertas.map((r) => ({ ofertaId: r.oferta_id, seccionId: r.seccion_id, asignaturaId: r.asignatura_id, anio: r.anio })),
    periodos: periodos.map((r) => ({
      periodoId: r.periodo_id, anio: r.anio, numero: r.numero, nombre: r.nombre, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin,
    })),
    secciones: secciones.map((r) => ({
      seccionId: r.seccion_id, anio: r.anio, nivel: r.nivel, grado: r.grado, seccion: r.seccion, gradoFuente: r.grado_fuente,
    })),
  };
}
