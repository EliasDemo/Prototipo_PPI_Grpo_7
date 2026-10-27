import { z } from "zod";
import { verificarPassword } from "@/modules/autenticacion/password";
import { COOKIE_SESION, firmarSesion, iguales } from "@/modules/autenticacion/sesion";
import { env } from "@/server/config/env";
import { ErrorApi, ok } from "@/server/http/respuestas";
import { ruta, rutaPublica } from "@/server/http/ruta";

const credenciales = z.object({ usuario: z.string().min(1).max(100), password: z.string().min(1).max(200) }).strict();

const atributosCookie = (maxAge: number) =>
  [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAge}`, ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])].join("; ");

/** Inicia sesión del operador. */
export const POST = rutaPublica(async (req) => {
  const e = env();
  const cuerpo = credenciales.parse(await req.json().catch(() => ({})));
  // Se verifica siempre la contraseña (aunque el usuario no coincida) para no revelar cuál falló por el tiempo.
  const claveOk = await verificarPassword(cuerpo.password, e.OPERADOR_PASSWORD_HASH);
  if (!(iguales(cuerpo.usuario, e.OPERADOR_USUARIO) && claveOk)) {
    throw new ErrorApi("CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos");
  }
  const exp = Math.floor(Date.now() / 1000) + e.SESSION_TTL_SEGUNDOS;
  const valor = firmarSesion({ usuario: cuerpo.usuario, exp }, e.SESSION_SECRET);
  return ok(
    { usuario: cuerpo.usuario, expira: new Date(exp * 1000).toISOString() },
    { headers: { "Set-Cookie": `${COOKIE_SESION}=${valor}; ${atributosCookie(e.SESSION_TTL_SEGUNDOS)}` } },
  );
});

/** Sesión actual (o token de benchmark). */
export const GET = ruta(async (_req, _ctx, auth) => ok(auth));

/** Cierra la sesión. */
export const DELETE = rutaPublica(async () =>
  ok({ cerrada: true }, { headers: { "Set-Cookie": `${COOKIE_SESION}=; ${atributosCookie(0)}` } }),
);
