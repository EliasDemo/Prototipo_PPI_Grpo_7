import { randomBytes, randomInt } from "node:crypto";
import type { PayloadEvento } from "@/modules/eventos/tipos";

// Eventos SINTÉTICOS del modo A (ADR-015): misma estructura (claves, tipos, nulos) y mismo tamaño
// en bytes que el payload real, pero sin ningún valor del conjunto de datos. Solo se conserva
// `tipo` (NOTA | ASISTENCIA), que describe la forma del evento y no a nadie.

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function texto(largoBytes: number): string {
  const b = randomBytes(largoBytes);
  let s = "";
  for (let i = 0; i < largoBytes; i++) s += ALFABETO[b[i]! % ALFABETO.length];
  return s;
}

/** Decimal como texto ("18.5000"): mismos dígitos antes y después del punto, valores al azar. */
function decimal(original: string): string {
  return original.replace(/\d/g, () => String(randomInt(10)));
}

function entero(n: number): number {
  const digitos = String(Math.abs(n)).length;
  const min = digitos === 1 ? 0 : 10 ** (digitos - 1);
  return (n < 0 ? -1 : 1) * randomInt(min, 10 ** digitos);
}

/** Un valor sintético del mismo tipo y del mismo largo en bytes (UTF-8) que el original. */
function valor(v: unknown): unknown {
  if (v === null) return null;
  if (typeof v === "boolean") return randomInt(2) === 1;
  if (typeof v === "number") return entero(v);
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) ? decimal(v) : texto(Buffer.byteLength(v, "utf8"));
  if (Array.isArray(v)) return v.map(valor);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)]));
  return v;
}

export function sintetizar(payload: PayloadEvento): Record<string, unknown> {
  const s = valor(payload) as Record<string, unknown>;
  s.tipo = payload.tipo;
  return s;
}
