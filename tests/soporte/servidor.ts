import { spawn, type ChildProcess } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { loadEnv } from "vite";
import type { TestProject } from "vitest/node";
import { huellaOrigen } from "./origen";

// globalSetup de integración (ADR-009):
//  - levanta `next dev` con LEDGER=null (NullLedger no existe en un build de producción),
//    salvo que TEST_BASE_URL apunte a un servidor ya levantado;
//  - toma la huella del origen antes y la compara al terminar: si cambió, la suite falla.

const PUERTO = 3199;

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  // `test.env` solo llega a los workers; el globalSetup corre en el proceso principal.
  for (const [k, v] of Object.entries(loadEnv("test", process.cwd(), ""))) process.env[k] ??= v;
  const antes = await huellaOrigen();
  let proc: ChildProcess | undefined;

  const externo = process.env.TEST_BASE_URL;
  if (externo) {
    project.provide("baseUrl", externo);
  } else {
    proc = spawn("pnpm", ["exec", "next", "dev", "-p", String(PUERTO)], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LEDGER: "null", NODE_ENV: "development" },
    });
    let salida = "";
    proc.stdout?.on("data", (d) => (salida += d));
    proc.stderr?.on("data", (d) => (salida += d));

    const baseUrl = `http://127.0.0.1:${PUERTO}`;
    const limite = Date.now() + 90000;
    for (;;) {
      try {
        const r = await fetch(`${baseUrl}/api/v1/autenticacion/sesion`, { method: "DELETE" });
        if (r.ok) break;
      } catch {
        // aún no escucha
      }
      if (proc.exitCode !== null || Date.now() > limite) throw new Error(`next dev no arrancó:\n${salida}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    project.provide("baseUrl", baseUrl);
  }

  return async () => {
    // Mata el grupo completo (pnpm -> next -> servidor).
    if (proc?.pid) process.kill(-proc.pid, "SIGTERM");
    const despues = await huellaOrigen();
    if (!isDeepStrictEqual(antes, despues)) {
      throw new Error(`¡La base de origen cambió durante las pruebas!\nantes: ${JSON.stringify(antes)}\ndespués: ${JSON.stringify(despues)}`);
    }
  };
}
