import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (clave: string, sal: Buffer, largo: number, opciones: ScryptOptions) =>
  new Promise<Buffer>((ok, mal) => scryptCb(clave, sal, largo, opciones, (e, k) => (e ? mal(e) : ok(k))));

// Formato: scrypt:N:r:p:sal:hash (base64url). Sin "$" para que dotenv no lo expanda.
const N = 16384, R = 8, P = 1, LARGO = 32;

export async function hashPassword(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(clave, sal, LARGO, { N, r: R, p: P });
  return ["scrypt", N, R, P, sal.toString("base64url"), hash.toString("base64url")].join(":");
}

export async function verificarPassword(clave: string, almacenado: string): Promise<boolean> {
  const [alg, n, r, p, sal, hash] = almacenado.split(":");
  if (alg !== "scrypt" || !n || !r || !p || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64url");
  const obtenido = await scrypt(clave, Buffer.from(sal, "base64url"), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return timingSafeEqual(obtenido, esperado);
}
