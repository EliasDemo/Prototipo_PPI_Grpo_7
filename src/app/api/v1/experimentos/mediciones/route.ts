import { z } from "zod";
import { aCsv, mediciones } from "@/modules/experimentos/repositorio";
import { ruta } from "@/server/http/ruta";

const filtros = z.object({ corrida: z.uuid().optional(), formato: z.enum(["csv", "json"]).default("csv") }).strict();

/** Descarga las mediciones, de una corrida o todas. */
export const GET = ruta(async (req) => {
  const f = filtros.parse(Object.fromEntries(req.nextUrl.searchParams));
  const filas = await mediciones(f.corrida ?? null);
  const csv = f.formato === "csv";
  return new Response(csv ? aCsv(filas) : JSON.stringify(filas, null, 2), {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json",
      "Content-Disposition": `attachment; filename="mediciones${f.corrida ? `-${f.corrida}` : ""}.${f.formato}"`,
      "Cache-Control": "no-store",
    },
  });
});
