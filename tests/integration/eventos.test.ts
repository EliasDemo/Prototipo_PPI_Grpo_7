import { randomUUID } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Confirmacion, EventoConEvidencia, PayloadNota, Verificacion } from "@/modules/eventos/tipos";
import { canonical } from "@/server/crypto/canonical";
import { huellaOrigen, type HuellaOrigen } from "../soporte/origen";
import { llamar, type ConError, type Datos } from "../soporte/api";

// Modelo de eventos con NullLedger (F3.7). Cada prueba usa sus propias Idempotency-Key.

const key = (p = "k") => `${p}-${randomUUID()}`;
let ro: mysql.Connection;
let exp: mysql.Connection;
let huellaInicial: HuellaOrigen;
let notaId: string;
let asistenciaId: string;

const conectar = (user: string, password: string, database: string) =>
  mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), user, password, database, dateStrings: true });

beforeAll(async () => {
  huellaInicial = await huellaOrigen();
  ro = await conectar(process.env.MYSQL_RO_USER!, process.env.MYSQL_RO_PASSWORD!, process.env.MYSQL_DB_ORIGEN!);
  exp = await conectar(process.env.MYSQL_EXP_USER!, process.env.MYSQL_EXP_PASSWORD!, process.env.MYSQL_DB_EXP!);
  const [[n]] = await ro.query<RowDataPacket[]>("SELECT calificacion_id id FROM calificaciones WHERE registrada = 1 ORDER BY calificacion_id LIMIT 1");
  const [[a]] = await ro.query<RowDataPacket[]>("SELECT asistencia_id id FROM asistencias WHERE estado_codigo = 'FI' ORDER BY asistencia_id LIMIT 1");
  notaId = n!.id;
  asistenciaId = a!.id;
});

afterAll(async () => {
  // Además de la comprobación global: esta suite no tocó el origen.
  expect(await huellaOrigen()).toEqual(huellaInicial);
  await ro.end();
  await exp.end();
});

const crear = (cuerpo: unknown, k = key("crear")) =>
  llamar<Datos<Confirmacion>>("/api/v1/eventos", { method: "POST", body: cuerpo, headers: { "idempotency-key": k } });

const rectificar = (registroId: string, cuerpo: unknown, k = key("rect")) =>
  llamar<Datos<Confirmacion>>(`/api/v1/eventos/${registroId}/rectificaciones`, { method: "POST", body: cuerpo, headers: { "idempotency-key": k } });

const verificar = async (eventoId: string) =>
  (await llamar<Datos<Verificacion>>(`/api/v1/trazabilidad/${eventoId}/verificar`, { method: "POST", headers: { "idempotency-key": key("ver") } })).json.data;

describe("crear copia de ensayo", () => {
  it("nota: registro nuevo, CREAR v1 confirmado y payload igual al origen sin datos del estudiante", async () => {
    const r = await crear({ tipo: "NOTA", origenId: notaId });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ version: 1, operacion: "CREAR", estadoOperacion: "CONFIRMADA" });

    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${r.json.data.eventoId}`)).json.data;
    const [[o]] = await ro.query<RowDataPacket[]>(
      `SELECT c.*, CAST(c.valor_numerico AS CHAR) vn, o.asignatura_id, o.seccion_id
         FROM calificaciones c JOIN ofertas o USING (oferta_id) WHERE calificacion_id = ?`,
      [notaId],
    );
    expect(ev.payload).toEqual({
      tipo: "NOTA", anio: o!.anio, periodoId: o!.periodo_id, ofertaId: o!.oferta_id, asignaturaId: o!.asignatura_id,
      seccionId: o!.seccion_id, valorFuente: o!.valor_fuente, valorNumerico: o!.vn, registrada: true,
      nivelAgregacion: o!.nivel_agregacion, motivo: null,
    } satisfies PayloadNota);
    expect(JSON.stringify(ev.payload)).not.toMatch(/EST-|estudiante/i);
    expect(ev.evidencia).toMatchObject({ evidenciaId: ev.evento.eventoId, version: 1, prevId: null, schemaVersion: 1 });
    expect(ev.operacion?.estado).toBe("CONFIRMADA");
  });

  it("asistencia", async () => {
    const r = await crear({ tipo: "ASISTENCIA", origenId: asistenciaId });
    expect(r.status).toBe(201);
    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${r.json.data.eventoId}`)).json.data;
    expect(ev.payload).toMatchObject({ tipo: "ASISTENCIA", estadoCodigo: "FI", estado: "FALTA INJUSTIFICADA" });
  });

  it("dos copias de la misma fila tienen el mismo payload canónico (hash estable) y distinta clave HMAC", async () => {
    const a = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    const b = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    const [[pa]] = await exp.query<RowDataPacket[]>("SELECT d.payload, d.bytes, e.hmac FROM evento_detalle d JOIN evento e USING (evento_id) WHERE evento_id = ?", [a.eventoId]);
    const [[pb]] = await exp.query<RowDataPacket[]>("SELECT d.payload, d.bytes, e.hmac FROM evento_detalle d JOIN evento e USING (evento_id) WHERE evento_id = ?", [b.eventoId]);
    expect(canonical(pa!.payload)).toBe(canonical(pb!.payload));
    expect(pa!.bytes).toBe(pb!.bytes);
    expect(pa!.hmac).not.toBe(pb!.hmac);
  });

  it("404 si la fila no existe en el origen", async () => {
    const r = await crear({ tipo: "NOTA", origenId: "NOT-00000000000000000000" });
    expect(r.status).toBe(404);
  });

  it.each([
    [{ tipo: "NOTA", origenId: "ASI-00000000000000000000" }],
    [{ tipo: "OTRO", origenId: "NOT-00000000000000000000" }],
    [{ tipo: "NOTA", origenId: "NOT-00000000000000000000", extra: 1 }],
  ])("400 con cuerpo inválido %o", async (cuerpo) => {
    expect((await crear(cuerpo)).status).toBe(400);
  });
});

describe("idempotencia", () => {
  it("400 sin Idempotency-Key o con una key inválida", async () => {
    const sin = await llamar<ConError>("/api/v1/eventos", { method: "POST", body: { tipo: "NOTA", origenId: notaId } });
    expect(sin.status).toBe(400);
    expect(sin.json.error.message).toMatch(/Idempotency-Key/);
    expect((await crear({ tipo: "NOTA", origenId: notaId }, "corta")).status).toBe(400);
  });

  it("reintento con la misma key: misma respuesta y nada duplicado", async () => {
    const k = key();
    const a = await crear({ tipo: "NOTA", origenId: notaId }, k);
    const b = await crear({ tipo: "NOTA", origenId: notaId }, k);
    expect(b.status).toBe(201);
    expect(b.json).toEqual(a.json);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    const [[n]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM operacion WHERE idempotency_key = ?", [k]);
    const [[r]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM evento WHERE registro_id = ?", [a.json.data.registroId]);
    expect([Number(n!.n), Number(r!.n)]).toEqual([1, 1]);
  });

  it("reintentos concurrentes con la misma key: uno ejecuta, ninguno duplica", async () => {
    const k = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => crear({ tipo: "NOTA", origenId: notaId }, k)));
    expect(rs.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const [[n]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM operacion WHERE idempotency_key = ?", [k]);
    expect(Number(n!.n)).toBe(1);
  });

  it("misma key con otro cuerpo -> 422", async () => {
    const k = key();
    await crear({ tipo: "NOTA", origenId: notaId }, k);
    const r = await crear({ tipo: "ASISTENCIA", origenId: asistenciaId }, k);
    expect(r.status).toBe(422);
    expect((r.json as unknown as ConError).error.code).toBe("IDEMPOTENCIA_CONFLICTO");
  });

  it("misma key en otra ruta -> 422", async () => {
    const k = key();
    const c = (await crear({ tipo: "NOTA", origenId: notaId }, k)).json.data;
    const r = await rectificar(c.registroId, { versionEsperada: 1, motivo: "x", cambios: { valorFuente: "C" } }, k);
    expect(r.status).toBe(422);
  });

  it("un 400 no consume la key: corregido el cuerpo, la misma key funciona", async () => {
    const k = key();
    expect((await crear({ tipo: "NOTA" }, k)).status).toBe(400);
    expect((await crear({ tipo: "NOTA", origenId: notaId }, k)).status).toBe(201);
  });
});

describe("rectificación y versiones", () => {
  it("encadena versiones con prev_evento_id y conserva la secuencia", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    const r2 = await rectificar(c.registroId, { versionEsperada: 1, motivo: "corrección", cambios: { valorFuente: "A" } });
    expect(r2.status).toBe(201);
    const r3 = await rectificar(c.registroId, { versionEsperada: 2, motivo: "otra", cambios: { valorNumerico: "17.5000", registrada: true } });
    expect(r3.json.data.version).toBe(3);

    const t = (await llamar<Datos<{ cadena: { eventoId: string; version: number; prevEventoId: string | null }[]; enlacesValidos: boolean; registro: { versionActual: number } }>>(
      `/api/v1/trazabilidad/${c.registroId}`,
    )).json.data;
    expect(t.registro.versionActual).toBe(3);
    expect(t.enlacesValidos).toBe(true);
    expect(t.cadena.map((e) => [e.version, e.prevEventoId])).toEqual([
      [1, null], [2, c.eventoId], [3, r2.json.data.eventoId],
    ]);
    const v3 = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${r3.json.data.eventoId}`)).json.data;
    expect(v3.payload).toMatchObject({ valorFuente: "A", valorNumerico: "17.5000", motivo: "otra" });
    expect(await verificar(r3.json.data.eventoId)).toMatchObject({ resultado: "OK" });
  });

  it("versión vieja -> 409 VERSION_DESACTUALIZADA con la versión actual", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    await rectificar(c.registroId, { versionEsperada: 1, motivo: "x", cambios: { valorFuente: "A" } });
    const r = await rectificar(c.registroId, { versionEsperada: 1, motivo: "y", cambios: { valorFuente: "C" } });
    expect(r.status).toBe(409);
    expect((r.json as unknown as ConError).error).toMatchObject({ code: "VERSION_DESACTUALIZADA", detalles: { versionActual: 2 } });
  });

  it("versión futura -> 409", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    expect((await rectificar(c.registroId, { versionEsperada: 5, motivo: "x", cambios: { valorFuente: "A" } })).status).toBe(409);
  });

  it("rectificaciones concurrentes sobre la misma versión: una gana, las demás reciben 409", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    // Cada una propone un valor distinto (la nota de origen no tiene valor numérico).
    const valores = ["11.0000", "12.0000", "13.0000", "14.0000", "15.0000"];
    const rs = await Promise.all(
      valores.map((v, i) => rectificar(c.registroId, { versionEsperada: 1, motivo: `concurrente ${i}`, cambios: { valorNumerico: v } })),
    );
    const estados = rs.map((r) => r.status).sort();
    expect(estados.filter((s) => s === 201)).toHaveLength(1);
    expect(estados.filter((s) => s === 409)).toHaveLength(valores.length - 1);
    rs.filter((r) => r.status === 409).forEach((r) => expect((r.json as unknown as ConError).error.code).toBe("VERSION_DESACTUALIZADA"));

    const [[n]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n, MAX(version) v FROM evento WHERE registro_id = ?", [c.registroId]);
    expect([Number(n!.n), Number(n!.v)]).toEqual([2, 2]);
  });

  it("400 con cambios no permitidos, vacíos o que no cambian nada", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    const actual = ((await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${c.eventoId}`)).json.data.payload as PayloadNota).valorFuente;
    for (const cambios of [{ anio: 2020 }, {}, { valorNumerico: 18.5 }, { valorNumerico: "1e3" }, { valorFuente: actual }]) {
      expect((await rectificar(c.registroId, { versionEsperada: 1, motivo: "x", cambios })).status, JSON.stringify(cambios)).toBe(400);
    }
  });

  it("asistencia: cambia el código y su etiqueta", async () => {
    const c = (await crear({ tipo: "ASISTENCIA", origenId: asistenciaId })).json.data;
    const r = await rectificar(c.registroId, { versionEsperada: 1, motivo: "justificada", cambios: { estadoCodigo: "FJ" } });
    const ev = (await llamar<Datos<EventoConEvidencia>>(`/api/v1/eventos/${r.json.data.eventoId}`)).json.data;
    expect(ev.payload).toMatchObject({ estadoCodigo: "FJ", estado: "FALTA JUSTIFICADA" });
  });

  it("404 para registro o evento inexistente", async () => {
    expect((await rectificar(randomUUID(), { versionEsperada: 1, motivo: "x", cambios: { valorFuente: "A" } })).status).toBe(404);
    expect((await llamar(`/api/v1/eventos/${randomUUID()}`)).status).toBe(404);
    expect((await llamar(`/api/v1/trazabilidad/${randomUUID()}`)).status).toBe(404);
    expect((await llamar("/api/v1/eventos/no-es-uuid")).status).toBe(404);
  });
});

describe("verificación", () => {
  it("OK recién creado; ALTERADO tras modificar evento_detalle en MySQL", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    expect(await verificar(c.eventoId)).toMatchObject({ resultado: "OK" });

    await exp.query("UPDATE evento_detalle SET payload = JSON_SET(payload, '$.valorFuente', 'AD') WHERE evento_id = ?", [c.eventoId]);
    const v = await verificar(c.eventoId);
    expect(v.resultado).toBe("ALTERADO");
    expect(v.detalles.join(" ")).toMatch(/HMAC recalculado/);
  });

  it("ALTERADO si se agrega un campo al detalle", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    await exp.query("UPDATE evento_detalle SET payload = JSON_SET(payload, '$.extra', 1) WHERE evento_id = ?", [c.eventoId]);
    expect((await verificar(c.eventoId)).resultado).toBe("ALTERADO");
  });

  it("ALTERADO si se reemplaza la clave HMAC", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    await exp.query("UPDATE evento_clave SET clave = RANDOM_BYTES(32) WHERE evento_id = ?", [c.eventoId]);
    expect((await verificar(c.eventoId)).resultado).toBe("ALTERADO");
  });

  it("DETALLE_RETIRADO si el detalle ya no existe", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    await exp.query("DELETE FROM evento_detalle WHERE evento_id = ?", [c.eventoId]);
    expect((await verificar(c.eventoId)).resultado).toBe("DETALLE_RETIRADO");
  });

  it("SIN_EVIDENCIA si el evento nunca llegó al ledger", async () => {
    const reg = randomUUID();
    const ev = randomUUID();
    await exp.query("INSERT INTO registro (registro_id, tipo, estrategia, version_actual) VALUES (?, 'NOTA', 'B', 1)", [reg]);
    await exp.query(
      "INSERT INTO evento (evento_id, registro_id, version, operacion, actor, fecha_experimental) VALUES (?, ?, 1, 'CREAR', 'operador', NOW(3))",
      [ev, reg],
    );
    expect((await verificar(ev)).resultado).toBe("SIN_EVIDENCIA");
  });

  it("la verificación repetida con la misma key devuelve el mismo resultado", async () => {
    const c = (await crear({ tipo: "NOTA", origenId: notaId })).json.data;
    const k = key("ver");
    const ruta = `/api/v1/trazabilidad/${c.eventoId}/verificar`;
    const a = await llamar(ruta, { method: "POST", headers: { "idempotency-key": k } });
    const b = await llamar(ruta, { method: "POST", headers: { "idempotency-key": k } });
    expect(b.json).toEqual(a.json);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
  });
});

describe("garantías de la base experimental", () => {
  it("ledger_simulado es append-only", async () => {
    await expect(exp.query("UPDATE ledger_simulado SET hmac = REPEAT('0', 64) LIMIT 1")).rejects.toThrow(/append-only/);
    await expect(exp.query("DELETE FROM ledger_simulado LIMIT 1")).rejects.toThrow(/append-only/);
  });

  it("evento es append-only salvo su estado de confirmación", async () => {
    await expect(exp.query("UPDATE evento SET hmac = REPEAT('0', 64) LIMIT 1")).rejects.toThrow(/append-only/);
  });

  it("app_exp no puede escribir en el origen", async () => {
    await expect(exp.query(`UPDATE \`${process.env.MYSQL_DB_ORIGEN}\`.calificaciones SET valor_fuente = 'X' LIMIT 1`)).rejects.toThrow(/denied/);
  });
});
