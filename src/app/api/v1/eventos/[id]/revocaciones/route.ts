import { revocar } from "@/modules/eventos/casos";
import { corridaDe, statusConfirmacion } from "@/modules/eventos/corrida";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ruta } from "@/server/http/ruta";

// [id] = registroId.

/** Revoca la versión vigente, en todas las estrategias. Body: { motivoCodigo }. Requiere Idempotency-Key. */
export const POST = ruta(async (req, ctx: RouteContext<"/api/v1/eventos/[id]/revocaciones">, auth) => {
  const { id } = await ctx.params;
  const corridaId = await corridaDe(req);
  return postIdempotente(req, `POST /api/v1/eventos/${id}/revocaciones`, async (cuerpo, key) => {
    const data = await revocar(id, cuerpo, auth, key, corridaId);
    return { status: statusConfirmacion(data), cuerpo: { data } };
  });
});
