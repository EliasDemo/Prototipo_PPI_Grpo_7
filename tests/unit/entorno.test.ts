import { afterEach, describe, expect, it, vi } from "vitest";
import { parsearEnv } from "@/server/config/env";
import { NullLedger } from "@/server/storage-strategies/null-ledger";

const BASE = {
  MYSQL_RO_USER: "app_ro", MYSQL_RO_PASSWORD: "x", MYSQL_EXP_USER: "app_exp", MYSQL_EXP_PASSWORD: "x",
  MYSQL_DB_ORIGEN: "o", MYSQL_DB_EXP: "e", SESSION_SECRET: "s".repeat(32), OPERADOR_USUARIO: "op",
  OPERADOR_PASSWORD_HASH: "scrypt:16384:8:1:abc:def", BENCH_TOKEN: "t".repeat(32),
};

afterEach(() => vi.unstubAllEnvs());

describe("NullLedger nunca en producción", () => {
  it("env.ts rechaza LEDGER=null con NODE_ENV=production", () => {
    expect(() => parsearEnv({ ...BASE, LEDGER: "null", NODE_ENV: "production" })).toThrow(/NullLedger/);
  });

  it("env.ts lo acepta en development y test", () => {
    expect(parsearEnv({ ...BASE, LEDGER: "null", NODE_ENV: "development" }).LEDGER).toBe("null");
    expect(parsearEnv({ ...BASE, LEDGER: "null", NODE_ENV: "test" }).LEDGER).toBe("null");
  });

  it("por defecto el ledger es fabric", () => {
    expect(parsearEnv({ ...BASE, NODE_ENV: "production" }).LEDGER).toBe("fabric");
  });

  it("el constructor de NullLedger también se niega en producción", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new NullLedger()).toThrow(/NODE_ENV=production/);
  });
});

describe("variables del servidor", () => {
  it("rechaza una variable del servidor expuesta con NEXT_PUBLIC_", () => {
    expect(() => parsearEnv({ ...BASE, NEXT_PUBLIC_BENCH_TOKEN: "x" })).toThrow(/NEXT_PUBLIC_BENCH_TOKEN/);
  });
});
