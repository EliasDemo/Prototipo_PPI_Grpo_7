import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// HMAC-SHA256 con una clave aleatoria de 32 bytes POR EVENTO (F3.3).
// La clave se guarda en evento_clave (MySQL) y nunca sale del servidor. Borrarla junto con el
// detalle (supresión, F7) deja la evidencia del ledger sin forma de vincularse a un contenido.
// No tiene relación con la seudonimización del conjunto de datos.

export const LARGO_CLAVE = 32;
const HEX_64 = /^[0-9a-f]{64}$/;

export function generarClave(): Buffer {
  return randomBytes(LARGO_CLAVE);
}

/** HMAC-SHA256 en hex minúsculas. */
export function calcularHmac(clave: Buffer, datos: Buffer): string {
  if (clave.length !== LARGO_CLAVE) throw new Error(`La clave HMAC debe tener ${LARGO_CLAVE} bytes`);
  return createHmac("sha256", clave).update(datos).digest("hex");
}

/** Compara en tiempo constante el HMAC recalculado con el esperado (hex). */
export function verificarHmac(clave: Buffer, datos: Buffer, esperadoHex: string): boolean {
  if (!HEX_64.test(esperadoHex)) return false;
  return timingSafeEqual(Buffer.from(calcularHmac(clave, datos), "hex"), Buffer.from(esperadoHex, "hex"));
}
