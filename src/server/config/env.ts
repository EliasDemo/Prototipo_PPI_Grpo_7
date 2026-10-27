import "server-only";
import { z } from "zod";

// Variables del servidor. Ninguna usa el prefijo NEXT_PUBLIC_: nada de esto llega al navegador.
const esquema = z.object({
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

  EXPERIMENT_STRATEGY: z.enum(["A", "B"]).default("B"),
  EXPERIMENT_SEED: z.coerce.number().int().default(20261027),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET debe tener al menos 32 caracteres"),
  SESSION_TTL_SEGUNDOS: z.coerce.number().int().positive().default(8 * 3600),
  OPERADOR_USUARIO: z.string().min(1),
  OPERADOR_PASSWORD_HASH: z.string().regex(/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/, "use pnpm auth:hash para generarlo"),
  BENCH_TOKEN: z.string().min(32, "BENCH_TOKEN debe tener al menos 32 caracteres"),
});

export type Env = z.infer<typeof esquema>;

let cache: Env | undefined;

/** Valida process.env una sola vez. Lanza un error legible si falta algo. */
export function env(): Env {
  if (cache) return cache;
  const r = esquema.safeParse(process.env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida en .env:\n${detalle}`);
  }
  const publicas = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_") && k.replace("NEXT_PUBLIC_", "") in esquema.shape);
  if (publicas.length) throw new Error(`Variables del servidor expuestas con NEXT_PUBLIC_: ${publicas.join(", ")}`);
  cache = r.data;
  return cache;
}
