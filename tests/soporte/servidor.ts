import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { TestProject } from "vitest/node";

// globalSetup de integración: usa TEST_BASE_URL si existe; si no, levanta `next start` sobre el build actual.

const PUERTO = 3199;

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const externo = process.env.TEST_BASE_URL;
  if (externo) {
    project.provide("baseUrl", externo);
    return;
  }
  if (!existsSync(".next/BUILD_ID")) throw new Error("No hay build: ejecute `pnpm build` (o use `pnpm test:int`).");

  const proc: ChildProcess = spawn("pnpm", ["exec", "next", "start", "-p", String(PUERTO)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let salida = "";
  proc.stdout?.on("data", (d) => (salida += d));
  proc.stderr?.on("data", (d) => (salida += d));

  const baseUrl = `http://127.0.0.1:${PUERTO}`;
  const limite = Date.now() + 45000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/api/v1/autenticacion/sesion`, { method: "DELETE" });
      break;
    } catch {
      if (proc.exitCode !== null || Date.now() > limite) throw new Error(`next start no arrancó:\n${salida}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  project.provide("baseUrl", baseUrl);

  return () => {
    // Mata el grupo completo (pnpm -> next -> next-server).
    if (proc.pid) process.kill(-proc.pid, "SIGTERM");
  };
}
