import { trazabilidad } from "@/modules/eventos/casos";
import { ok } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

// [id] = registroId (Next exige el mismo nombre de segmento que en [id]/verificar).

/** Cadena de versiones del registro y validez de sus enlaces. */
export const GET = ruta(async (_req, ctx: RouteContext<"/api/v1/trazabilidad/[id]">) => {
  const { id } = await ctx.params;
  return ok(await trazabilidad(id));
});
