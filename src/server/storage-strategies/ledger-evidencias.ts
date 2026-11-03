import "server-only";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Evidencia } from "@/modules/eventos/tipos";
import { canonical } from "@/server/crypto/canonical";
import { consultar, enviar, ErrorLedger } from "@/server/fabric/gateway";
import { ejecutar, esDuplicado, query } from "@/server/mysql/pool";
import { isoDesdeMysql } from "./persistencia-mysql";
import type { Anclaje } from "./outbox";

/** Dónde ancla sus evidencias la estrategia híbrida (B): Fabric o la tabla simulada. */
export interface LedgerEvidencias {
  anclar(e: Evidencia): Promise<Anclaje>;
  obtener(evidenciaId: string): Promise<Evidencia | null>;
}

/** JSON exacto que recibe RegistrarEvidencia: solo los campos que admite el chaincode. */
export function jsonEvidencia(e: Evidencia): string {
  return JSON.stringify({
    evidenciaId: e.evidenciaId,
    registroOpacoId: e.registroId,
    prevEvidenciaId: e.prevId,
    version: e.version,
    operacion: e.operacion,
    actorRol: e.actorRol,
    hmac: e.hmac,
    schemaVersion: e.schemaVersion,
  });
}

/** Fabric: chaincode `trazabilidad`, RegistrarEvidencia / ObtenerEvidencia. */
export class LedgerFabric implements LedgerEvidencias {
  async anclar(e: Evidencia): Promise<Anclaje> {
    const json = jsonEvidencia(e);
    const r = await enviar("RegistrarEvidencia", json);
    return { txId: r.txId, confirmada: r.confirmada, codigo: r.codigo, msSubmit: r.msSubmit, msCommit: r.msCommit, bytesOnchain: Buffer.byteLength(json) };
  }

  async obtener(id: string): Promise<Evidencia | null> {
    let texto: string;
    try {
      texto = await consultar("ObtenerEvidencia", id);
    } catch (err) {
      if (err instanceof ErrorLedger && err.codigo === "NO_ENCONTRADO") return null;
      throw err;
    }
    const r = JSON.parse(texto) as {
      tipo: string; evidenciaId: string; registroOpacoId: string; prevEvidenciaId: string | null; version: number;
      operacion: Evidencia["operacion"]; actorRol: string; hmac?: string; schemaVersion: number; fechaTx: string;
    };
    if (r.tipo !== "EVIDENCIA" || !r.hmac) return null;
    return {
      evidenciaId: r.evidenciaId, registroId: r.registroOpacoId, prevId: r.prevEvidenciaId, operacion: r.operacion,
      version: r.version, actorRol: r.actorRol, fechaExperimental: r.fechaTx, hmac: r.hmac, schemaVersion: r.schemaVersion,
    };
  }
}

/** Tabla append-only `ledger_simulado` (solo NullLedger: desarrollo y pruebas, ADR-010). */
export class LedgerTablaSimulada implements LedgerEvidencias {
  async anclar(e: Evidencia): Promise<Anclaje> {
    const json = jsonEvidencia(e);
    const txId = createHash("sha256").update(canonical(JSON.parse(json))).digest("hex");
    const t0 = performance.now();
    try {
      await ejecutar(
        "exp",
        `INSERT INTO ledger_simulado (evidencia_id, registro_id, prev_id, operacion, version, actor_rol, fecha_experimental,
                                      hmac, schema_version, tx_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.evidenciaId, e.registroId, e.prevId, e.operacion, e.version, e.actorRol, e.fechaExperimental, e.hmac, e.schemaVersion, txId],
      );
    } catch (err) {
      // Igual que el chaincode: mismo id con la misma evidencia = "ya registrada".
      if (!esDuplicado(err, "PRIMARY")) throw err;
      const previa = await this.obtener(e.evidenciaId);
      if (previa?.hmac !== e.hmac) throw new ErrorLedger("CONFLICTO", `la evidencia ${e.evidenciaId} ya existe con otro contenido`);
    }
    return { txId, confirmada: true, codigo: "VALID", msSubmit: performance.now() - t0, msCommit: 0, bytesOnchain: Buffer.byteLength(json) };
  }

  async obtener(id: string): Promise<Evidencia | null> {
    const [f] = await query<{
      evidencia_id: string; registro_id: string; prev_id: string | null; operacion: Evidencia["operacion"];
      version: number; actor_rol: string; fecha_experimental: string; hmac: string; schema_version: number; registrada_en: string;
    }>("exp", "SELECT * FROM ledger_simulado WHERE evidencia_id = ?", [id]);
    return f
      ? {
          evidenciaId: f.evidencia_id, registroId: f.registro_id, prevId: f.prev_id, operacion: f.operacion, version: f.version,
          actorRol: f.actor_rol, fechaExperimental: f.fecha_experimental || isoDesdeMysql(f.registrada_en), hmac: f.hmac,
          schemaVersion: f.schema_version,
        }
      : null;
  }
}
