import "server-only";
import { randomUUID } from "node:crypto";
import type { EstadoOperacion, EventoAcademico, EventoNuevo, Operacion, PayloadEvento } from "@/modules/eventos/tipos";
import { ErrorApi } from "@/server/http/respuestas";
import { esDuplicado, query, transaccion } from "@/server/mysql/pool";

// Persistencia común de eventos en la base experimental (pool `exp`, usuario app_exp).
// La comparten NullLedger y, desde F5, las estrategias A y B.

/** DATETIME(3) de MySQL en -05:00 (dateStrings) -> ISO UTC. */
export const isoDesdeMysql = (s: string) => new Date(`${s.replace(" ", "T")}-05:00`).toISOString();

export interface FilaEvento {
  evento_id: string;
  registro_id: string;
  version: number;
  operacion: Operacion;
  prev_evento_id: string | null;
  actor: string;
  fecha_experimental: string;
  hmac: string | null;
  estado_confirmacion: "PENDIENTE" | "CONFIRMADO" | "FALLIDO";
  payload: PayloadEvento | null;
  clave: Buffer | null;
  op_estado: EstadoOperacion | null;
  op_intentos: number | null;
  op_tx_id: string | null;
}

/**
 * Inserta registro (si es la versión 1), evento, detalle, clave y operación PENDIENTE en
 * una sola transacción. Para versiones > 1 bloquea el registro (SELECT ... FOR UPDATE) y
 * exige que version_actual = versionEsperada.
 */
export async function insertarEvento(
  { evento, registro, idempotencyKey }: EventoNuevo,
  versionEsperada: number,
  firma: { hmac: string; clave: Buffer; bytes: number },
): Promise<{ opId: string }> {
  if (evento.version !== versionEsperada + 1) throw new Error("La versión del evento debe ser versionEsperada + 1");
  const opId = randomUUID();

  try {
    await transaccion("exp", async (tx) => {
      if (versionEsperada === 0) {
        if (!registro || registro.registroId !== evento.registroId) throw new Error("CREAR requiere los datos del registro");
        await tx.ejecutar(
          `INSERT INTO registro (registro_id, tipo, estrategia, origen_tabla, origen_id, version_actual)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [registro.registroId, registro.tipo, registro.estrategia, registro.origenTabla, registro.origenId],
        );
      } else {
        const [r] = await tx.query<{ version_actual: number; estado_vigencia: string; estado_detalle: string }>(
          "SELECT version_actual, estado_vigencia, estado_detalle FROM registro WHERE registro_id = ? FOR UPDATE",
          [evento.registroId],
        );
        if (!r) throw new ErrorApi("NO_ENCONTRADO", "Registro no encontrado");
        if (r.estado_vigencia !== "VIGENTE" || r.estado_detalle !== "PRESENTE") {
          throw new ErrorApi("REGISTRO_NO_VIGENTE", "El registro está revocado o su detalle fue retirado");
        }
        if (r.version_actual !== versionEsperada) {
          throw new ErrorApi("VERSION_DESACTUALIZADA", "La versión esperada no es la vigente", {
            versionEsperada,
            versionActual: r.version_actual,
          });
        }
        const [prev] = await tx.query<{ evento_id: string }>(
          "SELECT evento_id FROM evento WHERE registro_id = ? AND version = ?",
          [evento.registroId, versionEsperada],
        );
        if (prev?.evento_id !== evento.prevEventoId) throw new Error("prevEventoId no corresponde a la versión esperada");
        await tx.ejecutar("UPDATE registro SET version_actual = ? WHERE registro_id = ?", [evento.version, evento.registroId]);
      }

      await tx.ejecutar(
        `INSERT INTO evento (evento_id, registro_id, version, operacion, prev_evento_id, actor, motivo,
                             fecha_experimental, schema_version, hmac)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)`,
        [
          evento.eventoId, evento.registroId, evento.version, evento.operacion, evento.prevEventoId,
          evento.actor, new Date(evento.fechaExperimental), firma.hmac,
        ],
      );
      await tx.ejecutar("INSERT INTO evento_detalle (evento_id, payload, temporal, bytes) VALUES (?, ?, FALSE, ?)", [
        evento.eventoId, JSON.stringify(evento.payload), firma.bytes,
      ]);
      await tx.ejecutar("INSERT INTO evento_clave (evento_id, clave) VALUES (?, ?)", [evento.eventoId, firma.clave]);
      await tx.ejecutar(
        "INSERT INTO operacion (op_id, idempotency_key, evento_id, estado) VALUES (?, ?, ?, 'PENDIENTE')",
        [opId, idempotencyKey, evento.eventoId],
      );
    });
  } catch (e) {
    // Respaldo de UNIQUE(registro_id, version): otra transacción ganó la misma versión.
    if (esDuplicado(e, "uq_evento_version")) {
      throw new ErrorApi("VERSION_DESACTUALIZADA", "Otra rectificación ganó esta versión", { versionEsperada });
    }
    throw e;
  }
  return { opId };
}

/** Marca la operación y el evento como confirmados en el ledger. */
export async function confirmarOperacion(eventoId: string, txId: string): Promise<void> {
  await transaccion("exp", async (tx) => {
    await tx.ejecutar(
      `UPDATE operacion SET estado = 'CONFIRMADA', intentos = intentos + 1, tx_id = ?,
              enviada_en = COALESCE(enviada_en, NOW(3)), confirmada_en = NOW(3)
        WHERE evento_id = ?`,
      [txId, eventoId],
    );
    await tx.ejecutar("UPDATE evento SET estado_confirmacion = 'CONFIRMADO' WHERE evento_id = ?", [eventoId]);
  });
}

export async function leerEvento(eventoId: string): Promise<FilaEvento | null> {
  const [f] = await query<FilaEvento>(
    "exp",
    `SELECT e.evento_id, e.registro_id, e.version, e.operacion, e.prev_evento_id, e.actor, e.fecha_experimental,
            e.hmac, e.estado_confirmacion, d.payload, k.clave,
            o.estado op_estado, o.intentos op_intentos, o.tx_id op_tx_id
       FROM evento e
       LEFT JOIN evento_detalle d ON d.evento_id = e.evento_id
       LEFT JOIN evento_clave k ON k.evento_id = e.evento_id
       LEFT JOIN operacion o ON o.evento_id = e.evento_id
      WHERE e.evento_id = ?`,
    [eventoId],
  );
  return f ?? null;
}

export function aEventoAcademico(f: FilaEvento): EventoAcademico & { estadoConfirmacion: FilaEvento["estado_confirmacion"] } {
  return {
    eventoId: f.evento_id,
    registroId: f.registro_id,
    version: f.version,
    operacion: f.operacion,
    prevEventoId: f.prev_evento_id,
    actor: f.actor,
    fechaExperimental: isoDesdeMysql(f.fecha_experimental),
    payload: f.payload as PayloadEvento,
    estadoConfirmacion: f.estado_confirmacion,
  };
}
