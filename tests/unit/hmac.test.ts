import { describe, expect, it } from "vitest";
import { calcularHmac, generarClave, LARGO_CLAVE, verificarHmac } from "@/server/crypto/hmac";

const datos = Buffer.from('{"a":1,"schemaVersion":1}');

describe("HMAC-SHA256 por evento", () => {
  it("vector RFC 4231, caso 2 (clave ajustada a 32 bytes con relleno de ceros)", () => {
    // HMAC con una clave corta equivale a la misma clave rellena con ceros hasta el bloque (64 bytes).
    const clave = Buffer.alloc(32);
    Buffer.from("Jefe").copy(clave);
    expect(calcularHmac(clave, Buffer.from("what do ya want for nothing?"))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("las claves son aleatorias y de 32 bytes", () => {
    const a = generarClave();
    expect(a).toHaveLength(LARGO_CLAVE);
    expect(a.equals(generarClave())).toBe(false);
  });

  it("es estable con la misma clave y distinto con otra", () => {
    const k = generarClave();
    expect(calcularHmac(k, datos)).toBe(calcularHmac(k, datos));
    expect(calcularHmac(k, datos)).not.toBe(calcularHmac(generarClave(), datos));
  });

  it("verifica y detecta un byte alterado", () => {
    const k = generarClave();
    const h = calcularHmac(k, datos);
    expect(verificarHmac(k, datos, h)).toBe(true);
    expect(verificarHmac(k, Buffer.from('{"a":2,"schemaVersion":1}'), h)).toBe(false);
  });

  it.each(["", "abc", "Z".repeat(64), "A".repeat(64)])("rechaza un HMAC esperado mal formado: %s", (h) => {
    expect(verificarHmac(generarClave(), datos, h)).toBe(false);
  });

  it("rechaza claves de otro largo", () => {
    expect(() => calcularHmac(Buffer.alloc(16), datos)).toThrow();
  });
});
