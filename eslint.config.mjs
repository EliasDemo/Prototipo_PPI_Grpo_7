import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Caliper carga estos módulos con require (CommonJS).
    "benchmarks/caliper/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El chaincode (CommonJS, fabric-contract-api) tiene sus propias pruebas: pnpm test:cc
    "chaincode/**",
  ]),
]);

export default eslintConfig;
