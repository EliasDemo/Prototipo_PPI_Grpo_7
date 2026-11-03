import "server-only";
import { env } from "@/server/config/env";
import { EstrategiaA } from "./estrategia-a";
import { EstrategiaHibrida } from "./estrategia-b";
import { EstrategiaBD } from "./estrategia-bd";
import { LedgerFabric } from "./ledger-evidencias";
import { NullLedger } from "./null-ledger";
import type { StorageStrategy } from "./tipos";

export type { StorageStrategy } from "./tipos";

const g = globalThis as typeof globalThis & { __ppiEstrategia?: StorageStrategy };

/**
 * Estrategia fijada al arrancar según el .env (F5.4); no cambia durante una corrida.
 *  - EXPERIMENT_STRATEGY=BD -> línea base sin ledger (no necesita Fabric);
 *  - LEDGER=null            -> NullLedger (env.ts lo rechaza con NODE_ENV=production);
 *  - A | B con LEDGER=fabric -> estrategias del experimento sobre la red real.
 */
export function estrategia(): StorageStrategy {
  if (g.__ppiEstrategia) return g.__ppiEstrategia;
  const e = env();
  let s: StorageStrategy;
  if (e.EXPERIMENT_STRATEGY === "BD") s = new EstrategiaBD();
  else if (e.LEDGER === "null") s = new NullLedger();
  else if (e.EXPERIMENT_STRATEGY === "A") s = new EstrategiaA();
  else s = new EstrategiaHibrida("B", new LedgerFabric());
  return (g.__ppiEstrategia = s);
}
