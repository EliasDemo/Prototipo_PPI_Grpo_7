import { describe, expect, it } from "vitest";
import { conReintentos } from "@/server/storage-strategies/reintentos";

const base = (esperas: number[]) => ({
  maxIntentos: 3, backoffMs: 100, clasificarFallo: (e: unknown) => (e === "fatal" ? ("definitivo" as const) : ("reintentar" as const)),
  esperar: async (ms: number) => void esperas.push(ms),
});

describe("conReintentos", () => {
  it("reintenta con backoff exponencial hasta lograrlo", async () => {
    const esperas: number[] = [];
    let n = 0;
    const r = await conReintentos(async () => { if (++n < 3) throw new Error("red"); return "ok"; }, base(esperas));
    expect([r, n, esperas]).toEqual(["ok", 3, [100, 200]]);
  });
  it("respeta el máximo y propaga el último error", async () => {
    let n = 0;
    await expect(conReintentos(async () => { n++; throw new Error("red"); }, base([]))).rejects.toThrow("red");
    expect(n).toBe(3);
  });
  it("no repite un fallo definitivo", async () => {
    let n = 0;
    await expect(conReintentos(async () => { n++; throw "fatal"; }, base([]))).rejects.toBe("fatal");
    expect(n).toBe(1);
  });
  it("repite un resultado marcado y devuelve el último al agotar", async () => {
    let n = 0;
    const r = await conReintentos(async () => ++n, { ...base([]), repetir: () => true });
    expect([r, n]).toEqual([3, 3]);
  });
  it("avisa antes de cada intento", async () => {
    let avisos = 0;
    await conReintentos(async () => 1, { ...base([]), alIntentar: async () => void avisos++ });
    expect(avisos).toBe(1);
  });
});
