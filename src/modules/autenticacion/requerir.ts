import "server-only";
import type { NextRequest } from "next/server";
import { env } from "@/server/config/env";
import { ErrorApi } from "@/server/http/respuestas";
import { COOKIE_SESION, iguales, verificarSesion } from "./sesion";

export type Autenticado = { tipo: "operador"; usuario: string } | { tipo: "benchmark" };

/**
 * Acepta el token Bearer de Caliper (BENCH_TOKEN) o la cookie firmada del operador.
 * Si viene un Authorization, se evalúa solo ese: un token inválido no cae a la cookie.
 */
export function requireAuth(req: NextRequest): Autenticado {
  const e = env();
  const autorizacion = req.headers.get("authorization");
  if (autorizacion !== null) {
    const token = /^Bearer (.+)$/.exec(autorizacion)?.[1];
    if (token && iguales(token, e.BENCH_TOKEN)) return { tipo: "benchmark" };
    throw new ErrorApi("NO_AUTENTICADO", "Token inválido");
  }
  const sesion = verificarSesion(req.cookies.get(COOKIE_SESION)?.value, e.SESSION_SECRET);
  if (sesion && iguales(sesion.usuario, e.OPERADOR_USUARIO)) return { tipo: "operador", usuario: sesion.usuario };
  throw new ErrorApi("NO_AUTENTICADO", "Se requiere iniciar sesión");
}
