import { inject } from "vitest";
import { firmarSesion } from "@/modules/autenticacion/sesion";
import type { MetaPaginacion, RespuestaError } from "@/shared/types/api";

// Cliente HTTP de pruebas contra el servidor levantado por tests/soporte/servidor.ts.

export type Credencial = "bench" | "operador" | "ninguna" | Record<string, string>;

function cabeceras(c: Credencial): Record<string, string> {
  if (c === "ninguna") return {};
  if (c === "bench") return { authorization: `Bearer ${process.env.BENCH_TOKEN}` };
  if (c === "operador") {
    const exp = Math.floor(Date.now() / 1000) + 600;
    return { cookie: `ppi_sesion=${firmarSesion({ usuario: process.env.OPERADOR_USUARIO!, exp }, process.env.SESSION_SECRET!)}` };
  }
  return c;
}

export async function llamar<T = unknown>(
  ruta: string,
  opciones: { credencial?: Credencial; method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(new URL(ruta, inject("baseUrl")), {
    method: opciones.method ?? "GET",
    headers: {
      ...cabeceras(opciones.credencial ?? "bench"),
      ...opciones.headers,
      ...(opciones.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });
  return { status: res.status, headers: res.headers, json: (await res.json()) as T };
}

export type Paginada<T> = { data: T[]; meta: MetaPaginacion };
export type Datos<T> = { data: T };
export type ConError = RespuestaError;
