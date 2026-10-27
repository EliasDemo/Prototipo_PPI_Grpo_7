import { crearCopia } from "@/modules/eventos/casos";
import { postIdempotente } from "@/modules/eventos/idempotencia";
import { ruta } from "@/server/http/ruta";

/** Crea una copia de ensayo. Body: { tipo: "NOTA" | "ASISTENCIA", origenId }. Requiere Idempotency-Key. */
export const POST = ruta(async (req, _ctx, auth) =>
  postIdempotente(req, "POST /api/v1/eventos", async (cuerpo, key) => ({
    status: 201,
    cuerpo: { data: await crearCopia(cuerpo, auth, key) },
  })),
);
