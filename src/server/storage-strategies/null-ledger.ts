import "server-only";
import { EstrategiaHibrida } from "./estrategia-b";
import { LedgerTablaSimulada } from "./ledger-evidencias";

/**
 * NullLedger: la estrategia híbrida (B) sobre la tabla append-only `ledger_simulado`.
 * Sirve para desarrollar y probar sin Fabric. NUNCA en producción ni en el benchmark
 * (no hay consenso, endorsement ni red; ADR-010).
 */
export class NullLedger extends EstrategiaHibrida {
  constructor() {
    // Defensa adicional a env.ts: en un `next build`, NODE_ENV queda fijado en "production".
    if (process.env.NODE_ENV === "production") throw new Error("NullLedger no puede usarse con NODE_ENV=production");
    super("NULL", new LedgerTablaSimulada());
  }
}
