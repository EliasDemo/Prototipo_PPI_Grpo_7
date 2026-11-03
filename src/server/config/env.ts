import "server-only";
import { z } from "zod";

// Variables del servidor. Ninguna usa el prefijo NEXT_PUBLIC_: nada de esto llega al navegador.
const esquema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    MYSQL_HOST: z.string().min(1).default("127.0.0.1"),
    MYSQL_PORT: z.coerce.number().int().positive().default(3306),
    MYSQL_RO_USER: z.string().min(1),
    MYSQL_RO_PASSWORD: z.string().min(1),
    MYSQL_EXP_USER: z.string().min(1),
    MYSQL_EXP_PASSWORD: z.string().min(1),
    MYSQL_DB_ORIGEN: z.string().min(1),
    MYSQL_DB_EXP: z.string().min(1),
    MYSQL_POOL_SIZE: z.coerce.number().int().positive().default(10),
    MYSQL_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    // Fabric se configura en F4; hasta entonces son opcionales.
    FABRIC_PEER_ENDPOINT: z.string().optional(),
    FABRIC_PEER_HOST_ALIAS: z.string().optional(),
    FABRIC_MSP_ID: z.string().optional(),
    FABRIC_CERT_PATH: z.string().optional(),
    FABRIC_KEY_PATH: z.string().optional(),
    FABRIC_TLS_CERT_PATH: z.string().optional(),
    FABRIC_CHANNEL: z.string().default("trazabilidad"),
    FABRIC_CHAINCODE: z.string().default("trazabilidad"),
    FABRIC_COMMIT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

    EXPERIMENT_STRATEGY: z.enum(["A", "B", "BD"]).default("B"),
    EXPERIMENT_SEED: z.coerce.number().int().default(20261027),
    // `null` = NullLedger (ledger_simulado en MySQL). Solo desarrollo y pruebas.
    LEDGER: z.enum(["fabric", "null"]).default("fabric"),

    SESSION_SECRET: z.string().min(32, "SESSION_SECRET debe tener al menos 32 caracteres"),
    SESSION_TTL_SEGUNDOS: z.coerce.number().int().positive().default(8 * 3600),
    OPERADOR_USUARIO: z.string().min(1),
    OPERADOR_PASSWORD_HASH: z.string().regex(/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/, "use pnpm auth:hash para generarlo"),
    BENCH_TOKEN: z.string().min(32, "BENCH_TOKEN debe tener al menos 32 caracteres"),
  })
  .refine((e) => !(e.LEDGER === "null" && e.NODE_ENV === "production"), {
    message: "LEDGER=null (NullLedger) no se permite con NODE_ENV=production",
    path: ["LEDGER"],
  });

export type Env = z.infer<typeof esquema>;

/** Valida un conjunto de variables. Lanza un error legible si algo falta o no se permite. */
export function parsearEnv(fuente: Record<string, string | undefined>): Env {
  const r = esquema.safeParse(fuente);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida en .env:\n${detalle}`);
  }
  const claves = Object.keys(esquema.shape);
  const publicas = Object.keys(fuente).filter((k) => k.startsWith("NEXT_PUBLIC_") && claves.includes(k.slice("NEXT_PUBLIC_".length)));
  if (publicas.length) throw new Error(`Variables del servidor expuestas con NEXT_PUBLIC_: ${publicas.join(", ")}`);
  return r.data;
}

let cache: Env | undefined;

/** Variables del proceso, validadas una sola vez. */
export function env(): Env {
  return (cache ??= parsearEnv(process.env));
}
