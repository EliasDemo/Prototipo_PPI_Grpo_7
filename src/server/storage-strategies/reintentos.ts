// F6.3: reintentos con backoff exponencial. Sin dependencias, para probarlo de forma aislada.

export type Intentable = "reintentar" | "definitivo";

export interface OpcionesReintento<T> {
  maxIntentos: number;
  backoffMs: number;
  clasificarFallo: (e: unknown) => Intentable;
  /** Un resultado sin excepción que también conviene repetir (p. ej. MVCC_READ_CONFLICT). */
  repetir?: (r: T) => boolean;
  /** Antes de cada intento (marca la operación como ENVIADA y suma un intento). */
  alIntentar?: () => Promise<void>;
  esperar?: (ms: number) => Promise<void>;
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function conReintentos<T>(fn: () => Promise<T>, o: OpcionesReintento<T>): Promise<T> {
  const esperar = o.esperar ?? pausa;
  for (let i = 1; ; i++) {
    await o.alIntentar?.();
    const ultimo = i >= o.maxIntentos;
    try {
      const r = await fn();
      if (ultimo || !o.repetir?.(r)) return r;
    } catch (e) {
      if (ultimo || o.clasificarFallo(e) === "definitivo") throw e;
    }
    await esperar(o.backoffMs * 2 ** (i - 1));
  }
}
