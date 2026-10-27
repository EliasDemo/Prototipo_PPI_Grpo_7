import "server-only";
import { connection, type NextRequest } from "next/server";
import { requireAuth, type Autenticado } from "@/modules/autenticacion/requerir";
import { error } from "@/server/http/respuestas";

type Manejador<C> = (req: NextRequest, ctx: C) => Promise<Response>;
type ManejadorAutenticado<C> = (req: NextRequest, ctx: C, auth: Autenticado) => Promise<Response>;

/**
 * Envuelve un Route Handler de /api/v1: exige autenticación (requireAuth) y convierte
 * cualquier excepción en { error: { code, message } }.
 * Corre en el runtime Node.js (el único por defecto con cacheComponents; `export const runtime` no se admite).
 */
export function ruta<C>(fn: ManejadorAutenticado<C>): Manejador<C> {
  return rutaPublica((req, ctx) => fn(req, ctx, requireAuth(req)));
}

/** Igual que ruta() pero sin autenticación. Solo para iniciar sesión. */
export function rutaPublica<C>(fn: Manejador<C>): Manejador<C> {
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
