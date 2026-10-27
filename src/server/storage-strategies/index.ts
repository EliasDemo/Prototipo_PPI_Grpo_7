import "server-only";
import { env } from "@/server/config/env";
import { ErrorApi } from "@/server/http/respuestas";
import { NullLedger } from "./null-ledger";
import type { StorageStrategy } from "./tipos";

export type { StorageStrategy } from "./tipos";

const g = globalThis as typeof globalThis & { __ppiEstrategia?: StorageStrategy };

/**
 * Estrategia fijada al arrancar según el .env (no cambia durante una corrida).
 * LEDGER=null -> NullLedger (env.ts lo rechaza con NODE_ENV=production).
 */
export function estrategia(): StorageStrategy {
  if (g.__ppiEstrategia) return g.__ppiEstrategia;
  const e = env();
  if (e.LEDGER === "null") return (g.__ppiEstrategia = new NullLedger());
  throw new ErrorApi("NO_DISPONIBLE", `La estrategia ${e.EXPERIMENT_STRATEGY} sobre Fabric llega en F5; use LEDGER=null en desarrollo`);
}
