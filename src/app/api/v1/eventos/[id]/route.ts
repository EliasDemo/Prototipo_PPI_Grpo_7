import { obtenerEvento } from "@/modules/eventos/casos";
import { ok } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

// [id] = eventoId (Next exige el mismo nombre de segmento que en [id]/rectificaciones).

/** Detalle del evento, evidencia del ledger y estado de su operación. */
export const GET = ruta(async (_req, ctx: RouteContext<"/api/v1/eventos/[id]">) => {
  const { id } = await ctx.params;
  return ok(await obtenerEvento(id));
});
