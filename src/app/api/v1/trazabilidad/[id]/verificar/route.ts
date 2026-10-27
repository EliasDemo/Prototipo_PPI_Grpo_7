import { verificarEvento } from "@/modules/eventos/casos";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ErrorApi } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

// [id] = eventoId.

/**
 * Verifica un evento contra su evidencia: OK | ALTERADO | DETALLE_RETIRADO | SIN_EVIDENCIA.
 * Como todo POST, exige Idempotency-Key: un reintento con la misma key devuelve el resultado ya emitido.
 */
export const POST = ruta(async (req, ctx: RouteContext<"/api/v1/trazabilidad/[id]/verificar">) => {
  const { id } = await ctx.params;
  return postIdempotente(req, `POST /api/v1/trazabilidad/${id}/verificar`, async (cuerpo) => {
    if (cuerpo !== null && (typeof cuerpo !== "object" || Object.keys(cuerpo).length)) {
      throw new ErrorApi("VALIDACION", "Esta ruta no recibe cuerpo");
    }
    return { status: 200, cuerpo: { data: await verificarEvento(id) } };
  });
});
