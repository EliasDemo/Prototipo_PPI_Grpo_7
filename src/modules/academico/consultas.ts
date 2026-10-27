import "server-only";
import { ErrorApi } from "@/server/http/respuestas";
import type { MetaPaginacion } from "@/shared/types/api";
import * as repo from "./repositorio";
import {
  estudianteId,
  filtrosAsistencias,
  filtrosCalificaciones,
  filtrosCatalogo,
  filtrosEstudiantes,
  type EstudianteDetalle,
} from "./esquemas";

// Casos de uso de consulta. Reciben datos sin validar (query params) y devuelven datos listos para responder.

const meta = (f: { page: number; pageSize: number }, total: number): MetaPaginacion => ({
  page: f.page,
  pageSize: f.pageSize,
  total,
});

export async function buscarEstudiantes(entrada: unknown) {
  const f = filtrosEstudiantes.parse(entrada);
  const { data, total } = await repo.listarEstudiantes(f);
  return { data, meta: meta(f, total) };
}

export async function obtenerEstudiante(id: string): Promise<EstudianteDetalle> {
  const valido = estudianteId.safeParse(id);
  if (!valido.success || !(await repo.existeEstudiante(valido.data))) {
    throw new ErrorApi("NO_ENCONTRADO", "Estudiante no encontrado");
  }
  return { estudianteId: valido.data, matriculas: await repo.matriculasDeEstudiante(valido.data) };
}

export async function buscarCalificaciones(entrada: unknown) {
  const f = filtrosCalificaciones.parse(entrada);
  const { data, total } = await repo.listarCalificaciones(f);
  return { data, meta: meta(f, total) };
}

export async function buscarAsistencias(entrada: unknown) {
  const f = filtrosAsistencias.parse(entrada);
  const { data, total } = await repo.listarAsistencias(f);
  return { data, meta: meta(f, total) };
}

export async function obtenerCatalogo(entrada: unknown) {
  return repo.catalogo(filtrosCatalogo.parse(entrada));
}
