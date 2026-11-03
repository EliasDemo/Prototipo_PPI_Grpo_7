import "server-only";
import { env } from "@/server/config/env";
import { consultar, enviar, ErrorLedger, ErrorTimeoutCommit } from "@/server/fabric/gateway";
import { canonical } from "@/server/crypto/canonical";
import { ejecutar, query } from "@/server/mysql/pool";
import { LedgerTablaSimulada, revocarEnFabric } from "@/server/storage-strategies/ledger-evidencias";
import type { Anclaje } from "@/server/storage-strategies/outbox";
import {
  actualizarRevocacion,
  borrarDetalleTemporal,
  confirmarOperacion,
  marcarEnviada,
  marcarFallida,
} from "@/server/storage-strategies/persistencia-mysql";

// F6.4 Conciliación. Recorre lo que quedó en la bandeja y decide con lo que dice el ledger:
//  - ya está y coincide:   CONFIRMADA; TARDIA si la solicitud original se quedó sin respuesta de commit;
//  - ya está y difiere:    FALLIDA (CONFLICTO);
//  - no está:              se reenvía el mensaje guardado (el chaincode es idempotente);
//                          FALLIDA al agotar los intentos.

export interface ResumenConciliacion {
  revisadas: number;
  confirmadas: number;
  tardias: number;
  fallidas: number;
  sinResolver: number;
  revocaciones: number;
  llavesLiberadas: number;
}

interface Puerto {
  leer(id: string): Promise<Record<string, unknown> | null>;
  reenviar(funcion: string, json: string): Promise<Anclaje>;
  revocar(id: string, motivo: string): Promise<Anclaje>;
}

const puertoFabric: Puerto = {
  async leer(id) {
    try {
      return JSON.parse(await consultar("ObtenerEvidencia", id));
    } catch (e) {
      if (e instanceof ErrorLedger && e.codigo === "NO_ENCONTRADO") return null;
      throw e;
    }
  },
  async reenviar(funcion, json) {
    const r = await enviar(funcion, json);
    return { txId: r.txId, confirmada: r.confirmada, codigo: r.codigo, msSubmit: r.msSubmit, msCommit: r.msCommit, bytesOnchain: Buffer.byteLength(json) };
  },
  revocar: revocarEnFabric,
};

function puertoSimulado(): Puerto {
  const t = new LedgerTablaSimulada();
  return {
    async leer(id) {
      const e = await t.obtener(id);
      return e && {
        evidenciaId: e.evidenciaId, registroOpacoId: e.registroId, prevEvidenciaId: e.prevId, version: e.version,
        operacion: e.operacion, actorRol: e.actorRol, hmac: e.hmac, schemaVersion: e.schemaVersion,
      };
    },
    async reenviar(_f, json) {
      const m = JSON.parse(json);
      return t.anclar({
        evidenciaId: m.evidenciaId, registroId: m.registroOpacoId, prevId: m.prevEvidenciaId, operacion: m.operacion,
        version: m.version, actorRol: m.actorRol, fechaExperimental: new Date().toISOString(), hmac: m.hmac, schemaVersion: m.schemaVersion,
      });
    },
    revocar: (id, motivo) => t.revocar(id, motivo),
  };
}

/** Todos los campos enviados deben coincidir con lo guardado en el ledger. */
function coincide(enLedger: Record<string, unknown>, mensaje: string): boolean {
  return Object.entries(JSON.parse(mensaje) as Record<string, unknown>).every(([k, v]) => canonical({ v: enLedger[k] ?? null }) === canonical({ v: v ?? null }));
}

/** La solicitud HTTP interrumpida queda EN_CURSO: su reintento debe obtener el resultado final. */
async function completarSolicitud(key: string, status: number, cuerpo: unknown) {
  await ejecutar(
    "exp",
    "UPDATE solicitud_idempotente SET estado = 'COMPLETADA', status_http = ?, respuesta = ?, completada_en = NOW(3) WHERE idempotency_key = ? AND estado = 'EN_CURSO'",
    [status, JSON.stringify(cuerpo), key],
  );
}

export async function conciliar({ antiguedadSeg = 60, maxIntentos = 5 } = {}): Promise<ResumenConciliacion> {
  const e = env();
  const puerto = e.LEDGER === "null" ? puertoSimulado() : puertoFabric;
  const res: ResumenConciliacion = { revisadas: 0, confirmadas: 0, tardias: 0, fallidas: 0, sinResolver: 0, revocaciones: 0, llavesLiberadas: 0 };

  const ops = await query<{
    op_id: string; evento_id: string; idempotency_key: string; estado: string; intentos: number; tx_id: string | null; error: string | null;
    funcion_ledger: string | null; mensaje_ledger: string | null; estrategia: string; registro_id: string; version: number; operacion: string;
    t_ms: number;
  }>(
    "exp",
    `SELECT o.op_id, o.evento_id, o.idempotency_key, o.estado, o.intentos, o.tx_id, o.error, o.funcion_ledger, o.mensaje_ledger,
            r.estrategia, r.registro_id, e.version, e.operacion, TIMESTAMPDIFF(MICROSECOND, o.solicitada_en, NOW(3)) / 1000 t_ms
       FROM operacion o JOIN evento e ON e.evento_id = o.evento_id JOIN registro r ON r.registro_id = e.registro_id
      WHERE o.estado IN ('PENDIENTE', 'ENVIADA') AND o.actualizada_en <= NOW(3) - INTERVAL ? SECOND
      ORDER BY e.registro_id, e.version`,
    [antiguedadSeg],
  );

  for (const op of ops) {
    res.revisadas++;
    const fin = async (estado: "CONFIRMADA" | "TARDIA", txId: string | null, codigo: string, medicion: "CONFIRMADA" | "TARDIA") => {
      await confirmarOperacion(op.evento_id, txId, codigo, estado);
      await borrarDetalleTemporal(op.evento_id);
      const u = await ejecutar("exp", "UPDATE medicion SET resultado = ? WHERE op_id = ?", [medicion, op.op_id]);
      if (!u.affectedRows) {
        await ejecutar(
          "exp",
          "INSERT INTO medicion (op_id, estrategia, operacion, resultado, t_total_ms) VALUES (?, ?, ?, ?, ?)",
          [op.op_id, e.LEDGER === "null" ? "NULL" : op.estrategia, op.operacion, medicion, Number(op.t_ms)],
        );
      }
      await completarSolicitud(op.idempotency_key, 201, {
        data: { eventoId: op.evento_id, registroId: op.registro_id, version: op.version, operacion: op.operacion, estadoOperacion: estado, txId },
      });
      if (estado === "TARDIA") res.tardias++; else res.confirmadas++;
    };
    const falla = async (codigo: string, mensaje: string) => {
      await marcarFallida(op.evento_id, codigo, mensaje);
      await completarSolicitud(op.idempotency_key, 502, { error: { code: "LEDGER_RECHAZO", message: mensaje, detalles: { codigo } } });
      res.fallidas++;
    };

    try {
      if (op.estrategia === "BD") {
        await fin("CONFIRMADA", null, "SIN_LEDGER", "CONFIRMADA");
        continue;
      }
      if (!op.mensaje_ledger || !op.funcion_ledger) {
        await falla("SIN_MENSAJE", "La operación no conserva el mensaje hacia el ledger");
        continue;
      }
      const enLedger = await puerto.leer(op.evento_id);
      if (enLedger) {
        if (!coincide(enLedger, op.mensaje_ledger)) await falla("CONFLICTO", "El ledger tiene otro contenido para este id");
        // Se envió y nadie recibió el commit a tiempo: llegó tarde. Tras un corte antes de saberlo, es una confirmación normal.
        else if (op.tx_id && op.error) await fin("TARDIA", op.tx_id, "VALID", "TARDIA");
        else await fin("CONFIRMADA", (enLedger.txId as string | undefined) ?? op.tx_id, "VALID", "CONFIRMADA");
        continue;
      }
      if (op.intentos >= maxIntentos) {
        await falla("NO_ANCLADA", `No llegó al ledger tras ${op.intentos} intentos`);
        continue;
      }
      await marcarEnviada(op.evento_id);
      const a = await puerto.reenviar(op.funcion_ledger, op.mensaje_ledger);
      if (a.confirmada) await fin("CONFIRMADA", a.txId, a.codigo, "CONFIRMADA");
      else await falla(a.codigo, "El canal invalidó el reenvío");
    } catch (err) {
      if (err instanceof ErrorLedger && err.codigo !== "GATEWAY") await falla(err.codigo, err.message);
      else {
        // Red caída o sin respuesta de commit: sigue en la bandeja para la próxima pasada.
        if (!(err instanceof ErrorTimeoutCommit)) console.error("[conciliar]", err);
        res.sinResolver++;
      }
    }
  }

  const revs = await query<{ revocacion_id: string; evidencia_id: string; motivo_codigo: string; estrategia: string; idempotency_key: string; registro_id: string; version: number }>(
    "exp",
    `SELECT v.revocacion_id, v.evidencia_id, v.motivo_codigo, r.estrategia, v.idempotency_key, v.registro_id, e.version
       FROM revocacion v JOIN registro r ON r.registro_id = v.registro_id JOIN evento e ON e.evento_id = v.evidencia_id
      WHERE v.estado IN ('PENDIENTE', 'ENVIADA') AND v.creada_en <= NOW(3) - INTERVAL ? SECOND`,
    [antiguedadSeg],
  );
  for (const v of revs) {
    res.revocaciones++;
    try {
      const a = v.estrategia === "BD" ? null : await puerto.revocar(v.evidencia_id, v.motivo_codigo);
      if (a && !a.confirmada) {
        await actualizarRevocacion(v.revocacion_id, "FALLIDA", a.txId, a.codigo);
        continue;
      }
      await actualizarRevocacion(v.revocacion_id, "CONFIRMADA", a?.txId ?? null);
      await completarSolicitud(v.idempotency_key, 201, {
        data: { eventoId: v.evidencia_id, registroId: v.registro_id, version: v.version, operacion: "REVOCAR", estadoOperacion: "CONFIRMADA", txId: a?.txId ?? null },
      });
    } catch (err) {
      console.error("[conciliar] revocación", err);
      res.sinResolver++;
    }
  }

  // Solicitudes que murieron antes de crear su operación: nada se ejecutó, la key queda libre.
  const lib = await ejecutar(
    "exp",
    `DELETE s FROM solicitud_idempotente s
       LEFT JOIN operacion o ON o.idempotency_key = s.idempotency_key
       LEFT JOIN revocacion v ON v.idempotency_key = s.idempotency_key
      WHERE s.estado = 'EN_CURSO' AND o.op_id IS NULL AND v.revocacion_id IS NULL AND s.creada_en <= NOW(3) - INTERVAL ? SECOND`,
    [antiguedadSeg],
  );
  res.llavesLiberadas = lib.affectedRows;
  return res;
}
