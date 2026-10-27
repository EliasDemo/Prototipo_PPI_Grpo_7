import { createHmac, timingSafeEqual } from "node:crypto";

// Cookie firmada: base64url(JSON) + "." + base64url(HMAC-SHA256). Sin estado en el servidor.

export const COOKIE_SESION = "ppi_sesion";

export interface DatosSesion {
  usuario: string;
  /** Expiración en segundos epoch. */
  exp: number;
}

const firma = (cuerpo: string, secreto: string) => createHmac("sha256", secreto).update(cuerpo).digest("base64url");

export function firmarSesion(datos: DatosSesion, secreto: string): string {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString("base64url");
  return `${cuerpo}.${firma(cuerpo, secreto)}`;
}

/** Devuelve la sesión si la firma es válida y no expiró; si no, null. */
export function verificarSesion(valor: string | undefined, secreto: string, ahora = Date.now()): DatosSesion | null {
  if (!valor) return null;
  const [cuerpo, recibida, sobra] = valor.split(".");
  if (!cuerpo || !recibida || sobra !== undefined) return null;
  if (!iguales(recibida, firma(cuerpo, secreto))) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<DatosSesion>;
    if (typeof datos.usuario !== "string" || typeof datos.exp !== "number") return null;
    return datos.exp * 1000 > ahora ? { usuario: datos.usuario, exp: datos.exp } : null;
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante (también para longitudes distintas). */
export function iguales(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}
