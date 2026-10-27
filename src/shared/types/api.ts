// Contrato de respuesta de /api/v1. Lo comparten el servidor y la interfaz.

export interface MetaPaginacion {
  page: number;
  pageSize: number;
  total: number;
}

export interface RespuestaPaginada<T> {
  data: T[];
  meta: MetaPaginacion;
}

export interface RespuestaDatos<T> {
  data: T;
}

export type CodigoError =
  | "VALIDACION"
  | "NO_AUTENTICADO"
  | "CREDENCIALES_INVALIDAS"
  | "NO_ENCONTRADO"
  | "CONFLICTO"
  | "INTERNO";

export interface RespuestaError {
  error: { code: CodigoError; message: string; detalles?: unknown };
}
