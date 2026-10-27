import { z } from "zod";
import { paginacion } from "@/shared/validation/paginacion";

// Identificadores seudónimos del origen: PREFIJO-20 hex mayúsculas (p. ej. SEC-00ED1D59363A88B2AE2F).
const idOpaco = (prefijo: string) =>
  z.string().regex(new RegExp(`^${prefijo}-[0-9A-F]{20}$`), `debe tener el formato ${prefijo}-XXXXXXXXXXXXXXXXXXXX`);

export const estudianteId = idOpaco("EST");
const seccionId = idOpaco("SEC");
const asignaturaId = idOpaco("ASG");
const periodoId = z.string().regex(/^PER-\d{4}-\d$/, "debe tener el formato PER-AAAA-N");

const anio = z.coerce.number().int().min(2000).max(2100);
const fecha = z.iso.date();
const booleano = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const filtrosEstudiantes = paginacion
  .extend({ anio: anio.optional(), seccion: seccionId.optional() })
  .strict();

export const filtrosCalificaciones = paginacion
  .extend({
    anio: anio.optional(),
    seccion: seccionId.optional(),
    asignatura: asignaturaId.optional(),
    periodo: periodoId.optional(),
    registrada: booleano.optional(),
  })
  .strict();

export const filtrosAsistencias = paginacion
  .extend({ anio: anio.optional(), seccion: seccionId.optional(), desde: fecha.optional(), hasta: fecha.optional() })
  .strict()
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, { message: "desde debe ser <= hasta", path: ["desde"] });

export const filtrosCatalogo = z.object({ anio: anio.optional() }).strict();

export type FiltrosEstudiantes = z.infer<typeof filtrosEstudiantes>;
export type FiltrosCalificaciones = z.infer<typeof filtrosCalificaciones>;
export type FiltrosAsistencias = z.infer<typeof filtrosAsistencias>;
export type FiltrosCatalogo = z.infer<typeof filtrosCatalogo>;

// ----- Respuestas -----

export interface EstudianteResumen {
  estudianteId: string;
  matriculas: number;
  anios: number[];
}

export interface Matricula {
  matriculaId: string;
  anio: number;
  estado: string | null;
  seccion: { seccionId: string; nivel: string | null; grado: string; seccion: string };
  procedencia: { fuenteId: string; hoja: string; fila: number };
}

export interface EstudianteDetalle {
  estudianteId: string;
  matriculas: Matricula[];
}

export interface Calificacion {
  calificacionId: string;
  estudianteId: string;
  anio: number;
  periodoId: string;
  ofertaId: string;
  seccionId: string;
  asignaturaId: string;
  asignatura: string;
  /** Texto original de la celda: puede ser "-" o vacío. No se completa. */
  valorFuente: string | null;
  valorNumerico: number | null;
  registrada: boolean;
  nivelAgregacion: string;
  procedencia: { fuenteId: string; hoja: string; fila: number; columna: number };
}

export interface Asistencia {
  asistenciaId: string;
  estudianteId: string;
  seccionId: string;
  anio: number;
  fecha: string;
  estadoCodigo: string;
  estado: string;
  procedencia: { fuenteId: string; hoja: string; fila: number; columna: number };
}

export interface Catalogo {
  asignaturas: { asignaturaId: string; nombre: string; nombreFuente: string; espacioInicialFuente: boolean }[];
  ofertas: { ofertaId: string; seccionId: string; asignaturaId: string; anio: number }[];
  periodos: { periodoId: string; anio: number; numero: number; nombre: string; fechaInicio: string | null; fechaFin: string | null }[];
  secciones: { seccionId: string; anio: number; nivel: string | null; grado: string; seccion: string; gradoFuente: string }[];
}
