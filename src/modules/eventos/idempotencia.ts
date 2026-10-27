import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonical, ErrorCanonico } from "@/server/crypto/canonical";
import { ErrorApi, errorEsperado, type RespuestaJson } from "@/server/http/respuestas";
import { ejecutar, esDuplicado, query } from "@/server/mysql/pool";

// Idempotency-Key obligatorio en todos los POST (F3.5).
//  - misma key + mismo cuerpo (y ruta) -> se devuelve la respuesta guardada, sin ejecutar de nuevo;
//  - misma key + otro cuerpo           -> 422 IDEMPOTENCIA_CONFLICTO;
//  - misma key mientras la primera sigue en curso -> 409 SOLICITUD_EN_CURSO.
// Se guardan las respuestas de éxito y los errores de negocio (404/409). Los 400 de validación
// y los errores internos no se guardan: la solicitud no se ejecutó y puede reintentarse.

export const idempotencyKey = z
  .string({ error: "falta la cabecera Idempotency-Key" })
  .regex(/^[A-Za-z0-9._:-]{8,100}$/, "Idempotency-Key: 8 a 100 caracteres [A-Za-z0-9._:-]");

function huella(ruta: string, cuerpo: unknown): string {
  try {
    return createHash("sha256").update(canonical({ ruta, cuerpo })).digest("hex");
  } catch (e) {
    if (e instanceof ErrorCanonico) throw new ErrorApi("VALIDACION", `Cuerpo no admitido: ${e.message}`);
    throw e;
  }
}

export interface ResultadoIdempotente extends RespuestaJson {
  repetida: boolean;
}

export async function conIdempotencia(
  clave: string | null,
  ruta: string,
  cuerpo: unknown,
  ejecutarSolicitud: () => Promise<RespuestaJson>,
): Promise<ResultadoIdempotente> {
  const key = idempotencyKey.parse(clave ?? undefined);
  const hash = huella(ruta, cuerpo);

  try {
    await ejecutar("exp", "INSERT INTO solicitud_idempotente (idempotency_key, ruta, cuerpo_sha256) VALUES (?, ?, ?)", [key, ruta, hash]);
  } catch (e) {
    if (!esDuplicado(e)) throw e;
    const [previa] = await query<{ cuerpo_sha256: string; estado: string; status_http: number | null; respuesta: unknown }>(
      "exp",
      "SELECT cuerpo_sha256, estado, status_http, respuesta FROM solicitud_idempotente WHERE idempotency_key = ?",
      [key],
    );
    if (!previa) throw new ErrorApi("SOLICITUD_EN_CURSO", "Reintente: la solicitud previa con esta key se está liberando");
    if (previa.cuerpo_sha256 !== hash) {
      throw new ErrorApi("IDEMPOTENCIA_CONFLICTO", "Esta Idempotency-Key ya se usó con otro cuerpo o en otra ruta");
    }
    if (previa.estado !== "COMPLETADA") throw new ErrorApi("SOLICITUD_EN_CURSO", "La solicitud con esta key aún está en curso");
    return { status: previa.status_http ?? 200, cuerpo: previa.respuesta, repetida: true };
  }

  let resultado: RespuestaJson;
  try {
    resultado = await ejecutarSolicitud();
  } catch (e) {
    const esperado = errorEsperado(e);
    if (!esperado || esperado.status === 400) {
      await liberar(key);
      throw e;
    }
    resultado = esperado;
  }

  await ejecutar(
    "exp",
    `UPDATE solicitud_idempotente SET estado = 'COMPLETADA', status_http = ?, respuesta = ?, completada_en = NOW(3)
      WHERE idempotency_key = ?`,
    [resultado.status, JSON.stringify(resultado.cuerpo), key],
  );
  return { ...resultado, repetida: false };
}

async function liberar(key: string) {
  await ejecutar("exp", "DELETE FROM solicitud_idempotente WHERE idempotency_key = ? AND estado = 'EN_CURSO'", [key]).catch((e) =>
    console.error("[idempotencia] no se pudo liberar la key", e),
  );
}
