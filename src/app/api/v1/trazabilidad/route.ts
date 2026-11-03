import { z } from "zod";
import { listarRegistros } from "@/modules/eventos/repositorio";
import { paginado } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";
import { paginacion } from "@/shared/validation/paginacion";

const filtros = paginacion.strict();

/** Registros de ensayo, del más reciente al más antiguo. */
export const GET = ruta(async (req) => {
  const f: z.infer<typeof filtros> = filtros.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { data, total } = await listarRegistros(f.page, f.pageSize);
  return paginado(data, { page: f.page, pageSize: f.pageSize, total });
});
