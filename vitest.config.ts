import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const raiz = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": raiz("./src"),
      // `server-only` lanza fuera de React Server; en pruebas es un módulo vacío.
      "server-only": raiz("./tests/soporte/vacio.ts"),
    },
  },
  test: {
    environment: "node",
    // Variables del .env (incluidas las sin prefijo VITE_).
    env: loadEnv("test", process.cwd(), ""),
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Levanta `next dev` con LEDGER=null contra el MySQL de Docker (ADR-009).
          globalSetup: ["tests/soporte/servidor.ts"],
          testTimeout: 15000,
          hookTimeout: 120000,
        },
      },
      {
        extends: true,
        test: {
          name: "fabric",
          include: ["tests/fabric/**/*.test.ts"],
          // Red real y estrategia de EXPERIMENT_STRATEGY (BD no necesita red).
          globalSetup: ["tests/soporte/servidor.ts"],
          testTimeout: 60000,
          hookTimeout: 120000,
          fileParallelism: false,
        },
      },
    ],
  },
});
