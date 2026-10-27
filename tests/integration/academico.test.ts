import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import esperados from "../../database/source/conteos-esperados.json";
import type { Asistencia, Calificacion, Catalogo, EstudianteDetalle, EstudianteResumen } from "@/modules/academico/esquemas";
import type { ResumenDatos } from "@/modules/datos/resumen";
import { llamar, type ConError, type Datos, type Paginada } from "../soporte/api";

// Se contrasta la API con consultas directas (app_ro) a la misma base.
let db: mysql.Connection;
const uno = async (sql: string, params: unknown[] = []) => {
  const [filas] = await db.query<RowDataPacket[]>(sql, params);
  return filas[0]!;
};

let catalogo: Catalogo;

beforeAll(async () => {
  db = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), user: process.env.MYSQL_RO_USER,
    password: process.env.MYSQL_RO_PASSWORD, database: process.env.MYSQL_DB_ORIGEN, dateStrings: true,
  });
  catalogo = (await llamar<Datos<Catalogo>>("/api/v1/academico/catalogo")).json.data;
});
afterAll(() => db.end());

describe("GET /api/v1/datos/resumen", () => {
  it("coincide con los conteos verificados en F1", async () => {
    const { status, json } = await llamar<Datos<ResumenDatos>>("/api/v1/datos/resumen");
    expect(status).toBe(200);
    expect(json.data.conteos).toMatchObject(esperados.tablas);
    expect(json.data.conteos.calificacionesRegistradas).toBe(esperados.derivados.notas_registradas_2026);
    for (const a of json.data.anios) {
      expect(a.matriculas).toBe(esperados.derivados.matriculas_por_anio[String(a.anio) as "2024"]);
      expect(a.asistencias).toBe(esperados.derivados.asistencias_por_anio[String(a.anio) as "2024"]);
    }
    expect(json.data.fuentes).toHaveLength(esperados.tablas.fuentes);
    expect(json.data.diferencias).toHaveLength(esperados.derivados.controles_no_coinciden);
    expect(json.data.diferencias.every((d) => d.extraido - d.totalFuente === d.diferencia)).toBe(true);
  });
});

describe("GET /api/v1/academico/estudiantes", () => {
  it("pagina con meta y 50 por defecto", async () => {
    const { json } = await llamar<Paginada<EstudianteResumen>>("/api/v1/academico/estudiantes");
    expect(json.meta).toEqual({ page: 1, pageSize: 50, total: esperados.tablas.estudiantes });
    expect(json.data).toHaveLength(50);
  });

  it("filtra por año", async () => {
    const { json } = await llamar<Paginada<EstudianteResumen>>("/api/v1/academico/estudiantes?anio=2024&pageSize=200");
    expect(json.meta.total).toBe(esperados.derivados.matriculas_por_anio["2024"]);
    expect(json.data.every((e) => e.anios.includes(2024))).toBe(true);
  });

  it("filtra por sección y año, y la última página es parcial", async () => {
    const s = catalogo.secciones[0]!;
    const { n } = await uno("SELECT COUNT(DISTINCT estudiante_id) n FROM matriculas WHERE seccion_id = ? AND anio = ?", [s.seccionId, s.anio]);
    const base = `/api/v1/academico/estudiantes?anio=${s.anio}&seccion=${s.seccionId}&pageSize=7`;
    const p1 = (await llamar<Paginada<EstudianteResumen>>(base)).json;
    expect(p1.meta.total).toBe(Number(n));
    const ultima = Math.ceil(p1.meta.total / 7);
    const pu = (await llamar<Paginada<EstudianteResumen>>(`${base}&page=${ultima}`)).json;
    expect(pu.data).toHaveLength(p1.meta.total - (ultima - 1) * 7);
    const fuera = (await llamar<Paginada<EstudianteResumen>>(`${base}&page=${ultima + 1}`)).json;
    expect(fuera.data).toEqual([]);
  });
});

describe("GET /api/v1/academico/estudiantes/:id", () => {
  it("devuelve las matrículas del estudiante", async () => {
    const { id, n } = await uno(
      "SELECT estudiante_id id, COUNT(*) n FROM matriculas GROUP BY estudiante_id HAVING n = 3 ORDER BY estudiante_id LIMIT 1",
    );
    const { status, json } = await llamar<Datos<EstudianteDetalle>>(`/api/v1/academico/estudiantes/${id}`);
    expect(status).toBe(200);
    expect(json.data.matriculas).toHaveLength(Number(n));
    expect(json.data.matriculas.map((m) => m.anio)).toEqual([...json.data.matriculas.map((m) => m.anio)].sort());
  });

  it.each(["EST-00000000000000000000", "no-existe", "EST-1'--"])("404 para %s", async (id) => {
    const { status, json } = await llamar<ConError>(`/api/v1/academico/estudiantes/${encodeURIComponent(id)}`);
    expect(status).toBe(404);
    expect(json.error.code).toBe("NO_ENCONTRADO");
  });
});

describe("GET /api/v1/academico/calificaciones", () => {
  it.each([
    ["registrada=true", esperados.derivados.notas_registradas_2026],
    ["registrada=false", esperados.tablas.calificaciones - esperados.derivados.notas_registradas_2026],
    ["anio=2026", esperados.tablas.calificaciones],
    ["anio=2025", 0],
  ])("%s -> total correcto", async (q, total) => {
    expect((await llamar<Paginada<Calificacion>>(`/api/v1/academico/calificaciones?${q}`)).json.meta.total).toBe(total);
  });

  it("devuelve cada campo igual que la base (incluido valor_fuente '-')", async () => {
    const { json } = await llamar<Paginada<Calificacion>>("/api/v1/academico/calificaciones?registrada=false&pageSize=3");
    for (const c of json.data) {
      const fila = await uno("SELECT * FROM calificaciones WHERE calificacion_id = ?", [c.calificacionId]);
      expect(c).toMatchObject({
        estudianteId: fila.estudiante_id, periodoId: fila.periodo_id, ofertaId: fila.oferta_id, anio: fila.anio,
        valorFuente: fila.valor_fuente, registrada: false, nivelAgregacion: fila.nivel_agregacion,
        procedencia: { fuenteId: fila.fuente_id, hoja: fila.hoja_fuente, fila: fila.fila_fuente, columna: fila.columna_fuente },
      });
      expect(c.valorFuente).toBe("-");
    }
  });

  it("combina sección, asignatura y periodo", async () => {
    const o = catalogo.ofertas.find((x) => x.anio === 2026)!;
    const { n } = await uno(
      `SELECT COUNT(*) n FROM calificaciones c JOIN ofertas o USING (oferta_id)
        WHERE o.seccion_id = ? AND o.asignatura_id = ? AND c.periodo_id = 'PER-2026-1'`,
      [o.seccionId, o.asignaturaId],
    );
    const { json } = await llamar<Paginada<Calificacion>>(
      `/api/v1/academico/calificaciones?seccion=${o.seccionId}&asignatura=${o.asignaturaId}&periodo=PER-2026-1&pageSize=200`,
    );
    expect(json.meta.total).toBe(Number(n));
    expect(json.data.every((c) => c.seccionId === o.seccionId && c.asignaturaId === o.asignaturaId && c.periodoId === "PER-2026-1")).toBe(true);
  });
});

describe("GET /api/v1/academico/asistencias", () => {
  it.each(Object.entries(esperados.derivados.asistencias_por_anio))("anio=%s -> %i", async (anio, total) => {
    expect((await llamar<Paginada<Asistencia>>(`/api/v1/academico/asistencias?anio=${anio}&pageSize=1`)).json.meta.total).toBe(total);
  });

  it("rango de fechas inclusivo", async () => {
    const { n } = await uno("SELECT COUNT(*) n FROM asistencias WHERE fecha BETWEEN '2025-08-01' AND '2025-08-31'");
    const { json } = await llamar<Paginada<Asistencia>>("/api/v1/academico/asistencias?anio=2025&desde=2025-08-01&hasta=2025-08-31&pageSize=200");
    expect(json.meta.total).toBe(Number(n));
    expect(json.data.every((a) => a.fecha >= "2025-08-01" && a.fecha <= "2025-08-31")).toBe(true);
  });

  it("recorrer todas las páginas de una sección no repite ni pierde filas", async () => {
    const s = catalogo.secciones.find((x) => x.anio === 2026)!;
    const vistos = new Set<string>();
    let total = 0;
    for (let page = 1; ; page++) {
      const { json } = await llamar<Paginada<Asistencia>>(`/api/v1/academico/asistencias?anio=${s.anio}&seccion=${s.seccionId}&pageSize=200&page=${page}`);
      total = json.meta.total;
      json.data.forEach((a) => vistos.add(a.asistenciaId));
      if (json.data.length < 200) break;
    }
    expect(vistos.size).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/academico/catalogo", () => {
  it("devuelve el catálogo completo", () => {
    expect(catalogo.asignaturas).toHaveLength(esperados.tablas.asignaturas);
    expect(catalogo.ofertas).toHaveLength(esperados.tablas.ofertas);
    expect(catalogo.periodos).toHaveLength(esperados.tablas.periodos);
    expect(catalogo.secciones).toHaveLength(esperados.tablas.secciones);
  });

  it("filtra por año", async () => {
    const { json } = await llamar<Datos<Catalogo>>("/api/v1/academico/catalogo?anio=2026");
    expect(json.data.secciones.every((s) => s.anio === 2026)).toBe(true);
    expect(json.data.periodos).toHaveLength(4);
  });
});

describe("validación común", () => {
  it.each([
    "/api/v1/academico/asistencias?pageSize=201",
    "/api/v1/academico/calificaciones?registrada=si",
    "/api/v1/academico/estudiantes?nombre=x",
    "/api/v1/academico/estudiantes?anio=2024&anio=2025",
    "/api/v1/academico/asistencias?anio=2025&desde=2025-09-01&hasta=2025-01-01",
    "/api/v1/academico/asistencias?desde=2025-08-01",
    "/api/v1/academico/asistencias?seccion=SEC-1543F5A159A8AFC6A6CD",
  ])("400 VALIDACION: %s", async (ruta) => {
    const { status, json, headers } = await llamar<ConError>(ruta);
    expect(status).toBe(400);
    expect(json.error.code).toBe("VALIDACION");
    expect(headers.get("cache-control")).toContain("no-store");
  });
});
