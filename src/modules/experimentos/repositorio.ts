import "server-only";
import { query } from "@/server/mysql/pool";

export const listarCorridas = () =>
  query<Record<string, unknown>>(
    "exp",
    `SELECT c.corrida_id, c.estrategia, c.carga, c.tps_ofrecido, c.workers, c.repeticion, c.estado, c.git_commit, c.inicio, c.fin,
            r.solicitudes, r.confirmadas, r.fallidas, r.timeouts, r.tardias, r.t_total_prom_ms, r.bytes_onchain_prom
       FROM corrida c JOIN v_resumen_corrida r ON r.corrida_id = c.corrida_id
      ORDER BY c.inicio DESC, c.corrida_id LIMIT 500`,
  );

/** Solo tiempos y tamaños: sin ids de eventos ni de registros. */
export const mediciones = (corridaId: string | null) =>
  query<Record<string, unknown>>(
    "exp",
    `SELECT corrida_id, estrategia, operacion, resultado, t_mysql_ms, t_fabric_submit_ms, t_fabric_commit_ms, t_total_ms,
            bytes_onchain, bytes_offchain, registrada_en
       FROM medicion WHERE (? IS NULL OR corrida_id = ?) ORDER BY medicion_id`,
    [corridaId, corridaId],
  );

export function aCsv(filas: Record<string, unknown>[]): string {
  if (!filas.length) return "";
  const campo = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const columnas = Object.keys(filas[0]!);
  return [columnas.join(","), ...filas.map((f) => columnas.map((c) => campo(f[c])).join(","))].join("\n") + "\n";
}
