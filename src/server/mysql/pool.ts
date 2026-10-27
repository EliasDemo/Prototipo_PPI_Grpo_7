import "server-only";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
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
    // Ojo: campo.string() consume el valor del paquete; se llama una sola vez.
    typeCast: (campo, siguiente) => {
      if (campo.type !== "TINY" || campo.length !== 1) return siguiente();
      const v = campo.string();
      return v === null ? null : v === "1";
    },
  });
}

export function pool(nombre: NombrePool): Pool {
  return (g.__ppiPools![nombre] ??= crear(nombre));
}

export type Parametro = string | number | boolean | null | Date | Buffer;

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

/** INSERT / UPDATE / DELETE parametrizado; devuelve filas afectadas e insertId. */
export async function ejecutar(nombre: NombrePool, sql: string, params: readonly Parametro[] = []): Promise<ResultSetHeader> {
  const [r] = await pool(nombre).query<ResultSetHeader>({ sql, values: [...params], timeout: env().MYSQL_QUERY_TIMEOUT_MS });
  return r;
}

/** Conexión dentro de una transacción: mismas reglas que query()/ejecutar(). */
export interface Transaccion {
  query<T>(sql: string, params?: readonly Parametro[]): Promise<T[]>;
  ejecutar(sql: string, params?: readonly Parametro[]): Promise<ResultSetHeader>;
}

function envolver(c: PoolConnection): Transaccion {
  const timeout = env().MYSQL_QUERY_TIMEOUT_MS;
  return {
    async query<T>(sql: string, params: readonly Parametro[] = []) {
      const [filas] = await c.query<RowDataPacket[]>({ sql, values: [...params], timeout });
      return filas as T[];
    },
    async ejecutar(sql: string, params: readonly Parametro[] = []) {
      const [r] = await c.query<ResultSetHeader>({ sql, values: [...params], timeout });
      return r;
    },
  };
}

/** Ejecuta `fn` en una transacción: COMMIT si termina, ROLLBACK si lanza. */
export async function transaccion<T>(nombre: NombrePool, fn: (tx: Transaccion) => Promise<T>): Promise<T> {
  const c = await pool(nombre).getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(envolver(c));
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** true si el error es una clave duplicada de MySQL (opcionalmente, de un índice concreto). */
export function esDuplicado(e: unknown, indice?: string): boolean {
  const err = e as { code?: string; sqlMessage?: string };
  return err?.code === "ER_DUP_ENTRY" && (!indice || (err.sqlMessage ?? "").includes(`'${indice}'`) || (err.sqlMessage ?? "").includes(`.${indice}'`));
}

/** Para pruebas y apagado ordenado. */
export async function cerrarPools(): Promise<void> {
  const pools = Object.values(g.__ppiPools ?? {});
  g.__ppiPools = {};
  await Promise.all(pools.map((p) => p.end()));
}
