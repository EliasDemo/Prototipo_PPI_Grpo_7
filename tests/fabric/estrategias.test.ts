import { randomUUID } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Confirmacion, EventoConEvidencia, Verificacion } from "@/modules/eventos/tipos";
import { llamar, type Datos } from "../soporte/api";

// F5: ciclo crear, rectificar y verificar con la estrategia de EXPERIMENT_STRATEGY sobre la red real.
// Uso: EXPERIMENT_STRATEGY=A pnpm test:fabric   (también B y BD)

const ESTRATEGIA = process.env.EXPERIMENT_STRATEGY ?? "B";
const key = (p: string) => `${p}-${randomUUID()}`;
let exp: mysql.Connection;
let notaId: string;

const post = <T>(ruta: string, body?: unknown) =>
  llamar<Datos<T>>(ruta, { method: "POST", body, headers: { "idempotency-key": key("f") } });
const verificar = async (id: string) => (await post<Verificacion>(`/api/v1/trazabilidad/${id}/verificar`)).json.data;

beforeAll(async () => {
  const c = { host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), dateStrings: true };
  exp = await mysql.createConnection({ ...c, user: process.env.MYSQL_EXP_USER, password: process.env.MYSQL_EXP_PASSWORD, database: process.env.MYSQL_DB_EXP });
  const ro = await mysql.createConnection({ ...c, user: process.env.MYSQL_RO_USER, password: process.env.MYSQL_RO_PASSWORD, database: process.env.MYSQL_DB_ORIGEN });
  const [[n]] = await ro.query<RowDataPacket[]>("SELECT calificacion_id id FROM calificaciones WHERE registrada = 1 ORDER BY calificacion_id LIMIT 1");
  notaId = n!.id;
  await ro.end();
});
afterAll(() => exp.end());

describe(`estrategia ${ESTRATEGIA}`, () => {
  it("crea, rectifica y verifica, y mide cada etapa", async () => {
    const c = await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId });
    expect(c.status).toBe(201);
    expect(c.json.data.estadoOperacion).toBe("CONFIRMADA");

    const r = await post<Confirmacion>(`/api/v1/eventos/${c.json.data.registroId}/rectificaciones`, {
      versionEsperada: 1, motivo: "corrección de prueba", cambios: { valorNumerico: "15.0000" },
    });
    expect(r.status).toBe(201);
    expect(r.json.data.version).toBe(2);

    const esperado = ESTRATEGIA === "BD" ? "SIN_EVIDENCIA" : "OK";
    expect((await verificar(c.json.data.eventoId)).resultado).toBe(esperado);
    expect((await verificar(r.json.data.eventoId)).resultado).toBe(esperado);

    const [m] = await exp.query<RowDataPacket[]>(
      "SELECT resultado, t_mysql_ms, t_fabric_submit_ms, t_fabric_commit_ms, t_total_ms, bytes_onchain FROM medicion m JOIN operacion o USING (op_id) WHERE o.evento_id = ?",
      [r.json.data.eventoId],
    );
    expect(m[0]!.resultado).toBe("CONFIRMADA");
    expect(Number(m[0]!.t_total_ms)).toBeGreaterThan(0);
    if (ESTRATEGIA === "BD") expect(Number(m[0]!.bytes_onchain)).toBe(0);
    else expect(Number(m[0]!.t_fabric_commit_ms)).toBeGreaterThan(0);
  });

  it.runIf(ESTRATEGIA === "B")("B: detecta la alteración directa del detalle y el ledger no guarda contenido", async () => {
    const c = (await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId })).json.data;
    const antes = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${c.eventoId}`)).json.data;
    expect(antes.evidencia?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(antes.evidencia)).not.toContain(notaId);

    await exp.query("UPDATE evento_detalle SET payload = JSON_SET(payload, '$.valorNumerico', '20.0000') WHERE evento_id = ?", [c.eventoId]);
    const v = await verificar(c.eventoId);
    expect(v.resultado).toBe("ALTERADO");
    expect(v.detalles.join(" ")).toContain("HMAC recalculado");
  });

  it.runIf(ESTRATEGIA === "A")("A: el ledger guarda contenido sintético y el detalle temporal se borra", async () => {
    const c = (await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId })).json.data;
    const [d] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM evento_detalle WHERE evento_id = ?", [c.eventoId]);
    expect(Number(d[0]!.n)).toBe(0);
    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${c.eventoId}`)).json.data;
    expect(ev.payload?.tipo).toBe("NOTA");
    expect(JSON.stringify(ev.payload)).not.toMatch(/(OFE|SEC|ASG)-[0-9A-F]{20}/);
  });
});
