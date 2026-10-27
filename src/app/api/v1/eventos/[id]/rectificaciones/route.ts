import { rectificar } from "@/modules/eventos/casos";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ruta } from "@/server/http/ruta";

// [id] = registroId.

/** Rectifica un registro. Body: { versionEsperada, motivo, cambios }. Requiere Idempotency-Key. */
export const POST = ruta(async (req, ctx: RouteContext<"/api/v1/eventos/[id]/rectificaciones">, auth) => {
  const { id } = await ctx.params;
  return postIdempotente(req, `POST /api/v1/eventos/${id}/rectificaciones`, async (cuerpo, key) => ({
    status: 201,
    cuerpo: { data: await rectificar(id, cuerpo, auth, key) },
  }));
});
