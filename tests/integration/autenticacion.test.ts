import { describe, expect, it } from "vitest";
import { llamar, type ConError } from "../soporte/api";

const RUTAS = [
  "/api/v1/datos/resumen",
  "/api/v1/academico/estudiantes",
  "/api/v1/academico/estudiantes/EST-00000000000000000000",
  "/api/v1/academico/calificaciones",
  "/api/v1/academico/asistencias",
  "/api/v1/academico/catalogo",
  "/api/v1/autenticacion/sesion",
];

describe("requireAuth en /api/v1", () => {
  it.each(RUTAS)("401 sin credenciales: %s", async (ruta) => {
    const { status, json } = await llamar<ConError>(ruta, { credencial: "ninguna" });
    expect(status).toBe(401);
    expect(json.error.code).toBe("NO_AUTENTICADO");
  });

  it("401 con token incorrecto aunque haya una cookie válida", async () => {
    const { status } = await llamar("/api/v1/datos/resumen", {
      credencial: { authorization: "Bearer incorrecto" },
    });
    expect(status).toBe(401);
  });

  it("401 con cookie falsificada", async () => {
    const falsa = Buffer.from(JSON.stringify({ usuario: process.env.OPERADOR_USUARIO, exp: 9999999999 })).toString("base64url");
    const { status } = await llamar("/api/v1/datos/resumen", { credencial: { cookie: `ppi_sesion=${falsa}.firma` } });
    expect(status).toBe(401);
  });

  it("200 con BENCH_TOKEN y con cookie del operador", async () => {
    expect((await llamar("/api/v1/academico/catalogo", { credencial: "bench" })).status).toBe(200);
    expect((await llamar("/api/v1/academico/catalogo", { credencial: "operador" })).status).toBe(200);
  });
});

describe("POST /api/v1/autenticacion/sesion", () => {
  it("rechaza credenciales incorrectas sin revelar cuál falló", async () => {
    const a = await llamar<ConError>("/api/v1/autenticacion/sesion", {
      method: "POST", credencial: "ninguna", body: { usuario: "otro", password: "x" },
    });
    const b = await llamar<ConError>("/api/v1/autenticacion/sesion", {
      method: "POST", credencial: "ninguna", body: { usuario: process.env.OPERADOR_USUARIO, password: "x" },
    });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.json).toEqual(b.json);
  });

  it("400 con cuerpo inválido", async () => {
    const r = await llamar<ConError>("/api/v1/autenticacion/sesion", { method: "POST", credencial: "ninguna", body: { usuario: "" } });
    expect(r.status).toBe(400);
  });

  it("DELETE borra la cookie", async () => {
    const r = await llamar("/api/v1/autenticacion/sesion", { method: "DELETE", credencial: "ninguna" });
    expect(r.headers.get("set-cookie")).toMatch(/ppi_sesion=;.*Max-Age=0/);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
