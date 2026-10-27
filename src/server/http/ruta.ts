import "server-only";
import { connection, type NextRequest } from "next/server";
import { error } from "@/server/http/respuestas";

type Manejador<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Envuelve un Route Handler: cualquier excepción se convierte en { error: { code, message } }.
 * Corre en el runtime Node.js (el único por defecto con cacheComponents; `export const runtime` no se admite).
 */
export function ruta<C>(fn: Manejador<C>): Manejador<C> {
  return async (req, ctx) => {
    // Siempre dinámico: nunca se pre-renderiza en el build ni se sirve desde caché.
    await connection();
    try {
      return await fn(req, ctx);
    } catch (e) {
      return error(e);
    }
  };
}
