import { obtenerEstudiante } from "@/modules/academico/consultas";
import { ok } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

export const GET = ruta(async (_req, ctx: RouteContext<"/api/v1/academico/estudiantes/[id]">) => {
  const { id } = await ctx.params;
  return ok(await obtenerEstudiante(id));
});
