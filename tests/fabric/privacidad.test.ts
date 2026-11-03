import { randomUUID } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Confirmacion, EventoConEvidencia, ResultadoSupresion, Verificacion } from "@/modules/eventos/tipos";
import { llamar, type ConError, type Datos } from "../soporte/api";
import { huellaOrigen, type HuellaOrigen } from "../soporte/origen";

// F6 y F7 sobre la estrategia de EXPERIMENT_STRATEGY. Cubre las pruebas obligatorias 5, 7 y 9.

const ESTRATEGIA = process.env.EXPERIMENT_STRATEGY ?? "B";
const key = () => `p-${randomUUID()}`;
let exp: mysql.Connection;
let notaId: string;
let huella: HuellaOrigen;

const post = <T>(ruta: string, body?: unknown, k = key()) => llamar<Datos<T>>(ruta, { method: "POST", body, headers: { "idempotency-key": k } });
const crear = async () => (await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId })).json.data;
const verificar = async (id: string) => (await post<Verificacion>(`/api/v1/trazabilidad/${id}/verificar`)).json.data;
const REVOCAR = { motivoCodigo: "PRUEBA_DE_LABORATORIO" };

beforeAll(async () => {
  huella = await huellaOrigen();
  const c = { host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), dateStrings: true };
  exp = await mysql.createConnection({ ...c, user: process.env.MYSQL_EXP_USER, password: process.env.MYSQL_EXP_PASSWORD, database: process.env.MYSQL_DB_EXP });
  const ro = await mysql.createConnection({ ...c, user: process.env.MYSQL_RO_USER, password: process.env.MYSQL_RO_PASSWORD, database: process.env.MYSQL_DB_ORIGEN });
  const [[n]] = await ro.query<RowDataPacket[]>("SELECT calificacion_id id FROM calificaciones WHERE registrada = 1 ORDER BY calificacion_id LIMIT 1");
  notaId = n!.id;
  await ro.end();
});
afterAll(async () => {
  await exp.end();
  expect(await huellaOrigen()).toEqual(huella); // obligatoria 9
});

describe(`consistencia (${ESTRATEGIA})`, () => {
  it("un reintento con la misma key no duplica y una versión vieja recibe 409", async () => {
    const k = key();
    const a = await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId }, k);
    const b = await post<Confirmacion>("/api/v1/eventos", { tipo: "NOTA", origenId: notaId }, k);
    expect(b.json.data.eventoId).toBe(a.json.data.eventoId);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    const [[n]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM operacion WHERE idempotency_key = ?", [k]);
    expect(Number(n!.n)).toBe(1);

    const id = a.json.data.registroId;
    await post(`/api/v1/eventos/${id}/rectificaciones`, { versionEsperada: 1, motivo: "uno", cambios: { valorNumerico: "12.0000" } });
    const vieja = await post(`/api/v1/eventos/${id}/rectificaciones`, { versionEsperada: 1, motivo: "dos", cambios: { valorNumerico: "13.0000" } });
    expect(vieja.status).toBe(409);
  });

  it("el mensaje de la bandeja se vacía al confirmarse", async () => {
    const c = await crear();
    const [[o]] = await exp.query<RowDataPacket[]>("SELECT estado, mensaje_ledger m FROM operacion WHERE evento_id = ?", [c.eventoId]);
    expect(o).toMatchObject({ estado: "CONFIRMADA", m: null });
  });
});

describe(`revocación (${ESTRATEGIA})`, () => {
  it("cambia la vigencia, conserva el contenido y bloquea cambios", async () => {
    const c = await crear();
    const r = await post<Confirmacion>(`/api/v1/eventos/${c.registroId}/revocaciones`, REVOCAR);
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ operacion: "REVOCAR", estadoOperacion: "CONFIRMADA", version: 1 });

    const t = (await llamar<Datos<{ registro: { estadoVigencia: string; versionActual: number }; revocacion: { motivoCodigo: string } }>>(`/api/v1/trazabilidad/${c.registroId}`)).json.data;
    expect(t.registro).toMatchObject({ estadoVigencia: "REVOCADO", versionActual: 1 });
    expect(t.revocacion.motivoCodigo).toBe(REVOCAR.motivoCodigo);

    // Obligatoria 7: tras revocar, el contenido sigue legible.
    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${c.eventoId}`)).json.data;
    expect(ev.payload).not.toBeNull();
    expect((await post(`/api/v1/eventos/${c.registroId}/rectificaciones`, { versionEsperada: 1, motivo: "x", cambios: { valorNumerico: "14.0000" } })).status).toBe(409);
    expect((await post(`/api/v1/eventos/${c.registroId}/revocaciones`, REVOCAR)).status).toBe(409);
  });

  it("rechaza un motivo que no sea un código", async () => {
    const c = await crear();
    expect((await post(`/api/v1/eventos/${c.registroId}/revocaciones`, { motivoCodigo: "un texto libre" })).status).toBe(400);
  });
});

describe(`supresión (${ESTRATEGIA})`, () => {
  it.runIf(ESTRATEGIA === "B")("B: retira detalle, claves y vínculo; verificar responde DETALLE_RETIRADO", async () => {
    const c = await crear();
    const rect = (await post<Confirmacion>(`/api/v1/eventos/${c.registroId}/rectificaciones`, { versionEsperada: 1, motivo: "Texto libre", cambios: { valorNumerico: "16.0000" } })).json.data;
    expect((await verificar(rect.eventoId)).resultado).toBe("OK");

    const s = await post<ResultadoSupresion>(`/api/v1/privacidad/${c.registroId}/supresion`);
    expect(s.status).toBe(201);
    expect(s.json.data).toMatchObject({ versionesAfectadas: 2, detallesEliminados: 2, clavesEliminadas: 2 });
    expect(s.json.data.confirmacion).toMatchObject({ operacion: "SUPRIMIR", version: 3, estadoOperacion: "CONFIRMADA" });

    for (const id of [c.eventoId, rect.eventoId]) expect((await verificar(id)).resultado).toBe("DETALLE_RETIRADO");

    const [[r]] = await exp.query<RowDataPacket[]>("SELECT origen_id, origen_tabla, estado_detalle FROM registro WHERE registro_id = ?", [c.registroId]);
    expect(r).toMatchObject({ origen_id: null, origen_tabla: null, estado_detalle: "RETIRADO" });
    const [[d]] = await exp.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM evento_detalle x JOIN evento e USING (evento_id) WHERE e.registro_id = ?) d,
              (SELECT COUNT(*) FROM evento_clave x JOIN evento e USING (evento_id) WHERE e.registro_id = ?) k`, [c.registroId, c.registroId]);
    expect([Number(d!.d), Number(d!.k)]).toEqual([0, 0]);

    // La evidencia permanece en el ledger, sin contenido.
    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${rect.eventoId}`)).json.data;
    expect(ev.payload).toBeNull();
    expect(ev.evidencia?.hmac).toMatch(/^[0-9a-f]{64}$/);

    expect((await post(`/api/v1/privacidad/${c.registroId}/supresion`)).status).toBe(409);
  });

  it.runIf(ESTRATEGIA === "B")("B: un registro revocado también se puede suprimir", async () => {
    const c = await crear();
    await post(`/api/v1/eventos/${c.registroId}/revocaciones`, REVOCAR);
    expect((await post<ResultadoSupresion>(`/api/v1/privacidad/${c.registroId}/supresion`)).status).toBe(201);
    expect((await verificar(c.eventoId)).resultado).toBe("DETALLE_RETIRADO");
  });

  it.runIf(ESTRATEGIA !== "B")("sin híbrida responde 409 SUPRESION_NO_SOPORTADA y el contenido sigue legible", async () => {
    const c = await crear();
    const r = await post(`/api/v1/privacidad/${c.registroId}/supresion`);
    expect(r.status).toBe(409);
    expect((r.json as unknown as ConError).error.code).toBe("SUPRESION_NO_SOPORTADA");
    expect((await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${c.eventoId}`)).json.data.payload).not.toBeNull();
  });
});
