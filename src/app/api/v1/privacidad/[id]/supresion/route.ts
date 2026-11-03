import { suprimir } from "@/modules/eventos/casos";
import { corridaDe, statusConfirmacion } from "@/modules/eventos/corrida";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ErrorApi } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

// [id] = registroId.

/** Retira el detalle, las claves y el vínculo con el origen (solo B). En A responde 409 SUPRESION_NO_SOPORTADA. */
export const POST = ruta(async (req, ctx: RouteContext<"/api/v1/privacidad/[id]/supresion">, auth) => {
  const { id } = await ctx.params;
  const corridaId = await corridaDe(req);
  return postIdempotente(req, `POST /api/v1/privacidad/${id}/supresion`, async (cuerpo, key) => {
    if (cuerpo !== null && (typeof cuerpo !== "object" || Object.keys(cuerpo).length)) throw new ErrorApi("VALIDACION", "Esta ruta no recibe cuerpo");
    const data = await suprimir(id, auth, key, corridaId);
    return { status: statusConfirmacion(data.confirmacion), cuerpo: { data } };
  });
});
