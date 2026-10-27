import "server-only";
import type { NextRequest } from "next/server";
import { error } from "@/server/http/respuestas";

type Manejador<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Envuelve un Route Handler: cualquier excepción se convierte en { error: { code, message } }. */
export function ruta<C>(fn: Manejador<C>): Manejador<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return error(e);
    }
  };
}
