import { listarCorridas } from "@/modules/experimentos/repositorio";
import { ok } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

export const GET = ruta(async () => ok(await listarCorridas()));
