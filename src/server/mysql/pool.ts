import "server-only";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { env } from "@/server/config/env";

export type NombrePool = "ro" | "exp";

// Se guardan en globalThis para que el hot reload de `next dev` no abra pools nuevos.
const g = globalThis as typeof globalThis & { __ppiPools?: Partial<Record<NombrePool, Pool>> };
g.__ppiPools ??= {};

function crear(nombre: NombrePool): Pool {
  const e = env();
  const [user, password, database] =
    nombre === "ro"
      ? [e.MYSQL_RO_USER, e.MYSQL_RO_PASSWORD, e.MYSQL_DB_ORIGEN]
      : [e.MYSQL_EXP_USER, e.MYSQL_EXP_PASSWORD, e.MYSQL_DB_EXP];
  return mysql.createPool({
    host: e.MYSQL_HOST,
    port: e.MYSQL_PORT,
    user,
    password,
    database,
    connectionLimit: e.MYSQL_POOL_SIZE,
    connectTimeout: 5000,
    charset: "utf8mb4",
    timezone: "-05:00",
    // DATE como 'YYYY-MM-DD': sin conversiones de zona horaria.
    dateStrings: true,
    decimalNumbers: true,
    // BOOLEAN (TINYINT(1)) llega como true/false.
    typeCast: (campo, siguiente) =>
      campo.type === "TINY" && campo.length === 1 ? (campo.string() === null ? null : campo.string() === "1") : siguiente(),
  });
}

export function pool(nombre: NombrePool): Pool {
  return (g.__ppiPools![nombre] ??= crear(nombre));
}

export type Parametro = string | number | boolean | null | Date;

/**
 * Ejecuta SQL parametrizado (placeholders `?`) con timeout.
 * Nunca interpolar valores del usuario en `sql`: siempre van en `params`.
 */
export async function query<T>(nombre: NombrePool, sql: string, params: readonly Parametro[] = []): Promise<T[]> {
  const [filas] = await pool(nombre).query<RowDataPacket[]>({
    sql,
    values: [...params],
    timeout: env().MYSQL_QUERY_TIMEOUT_MS,
  });
  return filas as T[];
}

/** Para pruebas y apagado ordenado. */
export async function cerrarPools(): Promise<void> {
  const pools = Object.values(g.__ppiPools ?? {});
  g.__ppiPools = {};
  await Promise.all(pools.map((p) => p.end()));
}
