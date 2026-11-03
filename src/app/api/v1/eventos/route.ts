import { crearCopia } from "@/modules/eventos/casos";
import { corridaDe, statusConfirmacion } from "@/modules/eventos/corrida";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ruta } from "@/server/http/ruta";

/**
 * Crea una copia de ensayo. Body: { tipo: "NOTA" | "ASISTENCIA", origenId }. Requiere Idempotency-Key.
 * 201 si quedó CONFIRMADA; 202 si quedó en la bandeja esperando el commit (se concilia después).
 * Opcional: X-Corrida-Id (corrida del benchmark) para asociar la medición.
 */
export const POST = ruta(async (req, _ctx, auth) => {
  const corridaId = await corridaDe(req);
  return postIdempotente(req, "POST /api/v1/eventos", async (cuerpo, key) => {
    const data = await crearCopia(cuerpo, auth, key, corridaId);
    return { status: statusConfirmacion(data), cuerpo: { data } };
  });
});
