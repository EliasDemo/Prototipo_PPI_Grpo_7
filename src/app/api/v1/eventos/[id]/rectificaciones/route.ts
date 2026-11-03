import { rectificar } from "@/modules/eventos/casos";
import { corridaDe, statusConfirmacion } from "@/modules/eventos/corrida";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ruta } from "@/server/http/ruta";

// [id] = registroId.

/** Rectifica un registro. Body: { versionEsperada, motivo, cambios }. Requiere Idempotency-Key. */
export const POST = ruta(async (req, ctx: RouteContext<"/api/v1/eventos/[id]/rectificaciones">, auth) => {
  const { id } = await ctx.params;
  const corridaId = await corridaDe(req);
  return postIdempotente(req, `POST /api/v1/eventos/${id}/rectificaciones`, async (cuerpo, key) => {
    const data = await rectificar(id, cuerpo, auth, key, corridaId);
    return { status: statusConfirmacion(data), cuerpo: { data } };
  });
});
