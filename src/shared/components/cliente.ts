"use client";
import { useCallback, useEffect, useState } from "react";

// Cliente de /api/v1 para la interfaz: la UI solo consume la API.

export class ErrorCliente extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/v1${ruta}`, init);
  } catch {
    throw new ErrorCliente("RED", "No se pudo conectar con el servidor.", 0);
  }
  if (r.status === 401 && !ruta.startsWith("/autenticacion")) {
    window.location.assign("/acceso");
    throw new ErrorCliente("NO_AUTENTICADO", "Tu sesión terminó.", 401);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorCliente(j?.error?.code ?? "INTERNO", j?.error?.message ?? "El servidor no pudo completar la acción.", r.status);
  return j as T;
}

export const obtener = <T,>(ruta: string) => pedir<T>(ruta);

/** POST con una Idempotency-Key nueva por acción. */
export const enviar = <T,>(ruta: string, cuerpo?: unknown) =>
  pedir<T>(ruta, {
    method: "POST",
    headers: { "idempotency-key": `ui-${crypto.randomUUID()}`, ...(cuerpo === undefined ? {} : { "content-type": "application/json" }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

export function useDatos<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    setCargando(true);
    try {
      setDatos(await obtener<T>(ruta));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [ruta]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la carga inicial sincroniza con la API.
    void recargar();
  }, [recargar]);
  return { datos, error, cargando, recargar };
}
