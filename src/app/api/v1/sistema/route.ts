import { env } from "@/server/config/env";
import { ok } from "@/server/http/respuestas";
import { ruta } from "@/server/http/ruta";

/** Modo con el que corre el servidor; lo muestra la interfaz. */
export const GET = ruta(async () => {
  const e = env();
  return ok({ estrategia: e.EXPERIMENT_STRATEGY, ledger: e.EXPERIMENT_STRATEGY === "BD" ? "ninguno" : e.LEDGER === "null" ? "simulado" : "fabric" });
});
