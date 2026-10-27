import { obtenerCatalogo } from "@/modules/academico/consultas";
import { ok, parametros } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

export const GET = ruta(async (req) => ok(await obtenerCatalogo(parametros(req.nextUrl))));
