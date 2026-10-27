import { buscarAsistencias } from "@/modules/academico/consultas";
import { paginado, parametros } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

export const GET = ruta(async (req) => {
  const { data, meta } = await buscarAsistencias(parametros(req.nextUrl));
  return paginado(data, meta);
});
