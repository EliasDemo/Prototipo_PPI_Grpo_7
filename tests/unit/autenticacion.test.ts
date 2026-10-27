import { describe, expect, it } from "vitest";
import { hashPassword, verificarPassword } from "@/modules/autenticacion/password";
import { firmarSesion, iguales, verificarSesion } from "@/modules/autenticacion/sesion";

const SECRETO = "s".repeat(48);

describe("sesión firmada", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;

  it("acepta una cookie válida", () => {
    expect(verificarSesion(firmarSesion({ usuario: "op", exp }, SECRETO), SECRETO)).toEqual({ usuario: "op", exp });
  });

  it("rechaza firma con otro secreto", () => {
    expect(verificarSesion(firmarSesion({ usuario: "op", exp }, "otro".repeat(12)), SECRETO)).toBeNull();
  });

  it("rechaza contenido alterado", () => {
    const [, firma] = firmarSesion({ usuario: "op", exp }, SECRETO).split(".");
    const falso = Buffer.from(JSON.stringify({ usuario: "admin", exp })).toString("base64url");
    expect(verificarSesion(`${falso}.${firma}`, SECRETO)).toBeNull();
  });

  it("rechaza sesión expirada", () => {
    const valor = firmarSesion({ usuario: "op", exp: exp - 120 }, SECRETO);
    expect(verificarSesion(valor, SECRETO)).toBeNull();
  });

  it.each([undefined, "", "abc", "a.b.c", "a.b"])("rechaza valores mal formados: %s", (v) => {
    expect(verificarSesion(v, SECRETO)).toBeNull();
  });

  it("compara en tiempo constante sin fallar por longitudes distintas", () => {
    expect(iguales("abc", "abc")).toBe(true);
    expect(iguales("abc", "abcd")).toBe(false);
  });
});

describe("contraseña scrypt", () => {
  it("verifica la correcta y rechaza otra", async () => {
    const h = await hashPassword("clave-de-prueba");
    expect(h).toMatch(/^scrypt:16384:8:1:[\w-]+:[\w-]+$/);
    expect(h).not.toContain("$");
    expect(await verificarPassword("clave-de-prueba", h)).toBe(true);
    expect(await verificarPassword("otra-clave", h)).toBe(false);
  });

  it("dos hashes de la misma clave usan sal distinta", async () => {
    expect(await hashPassword("x".repeat(12))).not.toBe(await hashPassword("x".repeat(12)));
  });

  it("rechaza un hash mal formado", async () => {
    expect(await verificarPassword("x", "bcrypt:abc")).toBe(false);
  });
});
