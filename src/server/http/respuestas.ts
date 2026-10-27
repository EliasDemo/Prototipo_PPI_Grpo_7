import "server-only";
import { z } from "zod";
import type { CodigoError, MetaPaginacion, RespuestaError } from "@/shared/types/api";

const STATUS: Record<CodigoError, number> = {
  VALIDACION: 400,
  NO_AUTENTICADO: 401,
  CREDENCIALES_INVALIDAS: 401,
  NO_ENCONTRADO: 404,
  CONFLICTO: 409,
  VERSION_DESACTUALIZADA: 409,
  REGISTRO_NO_VIGENTE: 409,
  SOLICITUD_EN_CURSO: 409,
  IDEMPOTENCIA_CONFLICTO: 422,
  NO_DISPONIBLE: 503,
  INTERNO: 500,
};

/** Error esperado: se responde con su código y mensaje tal cual. */
export class ErrorApi extends Error {
  constructor(
    readonly code: CodigoError,
    message: string,
    readonly detalles?: unknown,
  ) {
    super(message);
  }
}

const SIN_CACHE = { "Cache-Control": "no-store" };

export const ok = <T>(data: T, init?: ResponseInit) =>
  Response.json({ data }, { ...init, headers: { ...SIN_CACHE, ...init?.headers } });

export const paginado = <T>(data: T[], meta: MetaPaginacion) => Response.json({ data, meta }, { headers: SIN_CACHE });

/** Respuesta ya resuelta (status + cuerpo JSON); la usa la capa de idempotencia para guardarla y repetirla. */
export interface RespuestaJson {
  status: number;
  cuerpo: unknown;
}

export const comoResponse = ({ status, cuerpo }: RespuestaJson, headers?: Record<string, string>) =>
  Response.json(cuerpo, { status, headers: { ...SIN_CACHE, ...headers } });

/** Errores esperados (ErrorApi, ZodError) como respuesta; null para cualquier otro. */
export function errorEsperado(e: unknown): RespuestaJson | null {
  if (e instanceof ErrorApi) return cuerpoError(e.code, e.message, e.detalles);
  if (e instanceof z.ZodError) {
    const detalles = e.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message }));
    return cuerpoError("VALIDACION", "Parámetros inválidos", detalles);
  }
  return null;
}

export function error(e: unknown): Response {
  const esperado = errorEsperado(e);
  if (esperado) return comoResponse(esperado);
  // No se filtra el detalle interno (SQL, rutas, credenciales) al cliente.
  console.error("[api] error no controlado", e);
  return comoResponse(cuerpoError("INTERNO", "Error interno del servidor"));
}

function cuerpoError(code: CodigoError, message: string, detalles?: unknown): RespuestaJson {
  const cuerpo: RespuestaError = { error: { code, message, ...(detalles === undefined ? {} : { detalles }) } };
  return { status: STATUS[code], cuerpo };
}

/** Convierte los query params en objeto. Un parámetro repetido es un error. */
export function parametros(url: URL): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (k in salida) throw new ErrorApi("VALIDACION", `Parámetro repetido: ${k}`);
    salida[k] = v;
  }
  return salida;
}
