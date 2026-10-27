/**
 * F1.4 · Verifica el origen importado y los permisos de las cuentas.
 * Uso: pnpm db:verify
 * Requiere: mysql2, tsx (variables vía tsx --env-file).
 * Salida: artifacts/reports/verificacion-origen.json  · código 1 si algo falla.
 */
import mysql, { type RowDataPacket } from "mysql2/promise";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "../..");
const esperados = JSON.parse(
  readFileSync(resolve(RAIZ, "database/source/conteos-esperados.json"), "utf8"),
);
const DB_ORIGEN = process.env.MYSQL_DB_ORIGEN ?? "investigacion_peruschool";
const DB_EXP = process.env.MYSQL_DB_EXP ?? "investigacion_experimental";

type Check = { prueba: string; esperado: unknown; obtenido: unknown; ok: boolean };
const checks: Check[] = [];
const registrar = (prueba: string, esperado: unknown, obtenido: unknown) => {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  checks.push({ prueba, esperado, obtenido, ok });
  console.log(`${ok ? "✔" : "✘"} ${prueba}: ${JSON.stringify(obtenido)}${ok ? "" : `  (esperado ${JSON.stringify(esperado)})`}`);
};

const conexion = (user: string | undefined, password: string | undefined, database?: string) =>
  mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user,
    password,
    database,
  });

async function uno(c: mysql.Connection, sql: string): Promise<number> {
  const [rows] = await c.query<RowDataPacket[]>(sql);
  return Number(Object.values(rows[0] ?? {})[0] ?? 0);
}

async function porAnio(c: mysql.Connection, tabla: string) {
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT anio, COUNT(*) AS n FROM \`${tabla}\` GROUP BY anio ORDER BY anio`,
  );
  return Object.fromEntries(rows.map((r) => [String(r.anio), Number(r.n)]));
}

async function main() {
  const ro = await conexion(process.env.MYSQL_RO_USER ?? "app_ro", process.env.MYSQL_RO_PASSWORD, DB_ORIGEN);

  // 1. Conteos por tabla
  for (const [tabla, n] of Object.entries<number>(esperados.tablas)) {
    registrar(`conteo ${tabla}`, n, await uno(ro, `SELECT COUNT(*) FROM \`${tabla}\``));
  }

  // 2. Derivados
  const d = esperados.derivados;
  registrar("notas registradas 2026", d.notas_registradas_2026,
    await uno(ro, "SELECT COUNT(*) FROM calificaciones WHERE registrada = 1 AND anio = 2026"));
  registrar("calificaciones fuera de 2026", d.calificaciones_fuera_de_2026,
    await uno(ro, "SELECT COUNT(*) FROM calificaciones WHERE anio <> 2026"));
  registrar("controles que no coinciden", d.controles_no_coinciden,
    await uno(ro, "SELECT COUNT(*) FROM controles WHERE coincide = 0"));
  registrar("matrículas por año", d.matriculas_por_anio, await porAnio(ro, "matriculas"));
  registrar("asistencias por año", d.asistencias_por_anio, await porAnio(ro, "asistencias"));

  // 3. Integridad referencial (huérfanos = 0)
  const huerfanos: Record<string, string> = {
    "matriculas→estudiantes": "SELECT COUNT(*) FROM matriculas m LEFT JOIN estudiantes e USING (estudiante_id) WHERE e.estudiante_id IS NULL",
    "asistencias→matrícula del año": `SELECT COUNT(*) FROM asistencias a LEFT JOIN matriculas m
        ON m.estudiante_id = a.estudiante_id AND m.seccion_id = a.seccion_id AND m.anio = a.anio
        WHERE m.matricula_id IS NULL`,
    "calificaciones→ofertas": "SELECT COUNT(*) FROM calificaciones c LEFT JOIN ofertas o USING (oferta_id) WHERE o.oferta_id IS NULL",
    "calificaciones→periodo del mismo año": `SELECT COUNT(*) FROM calificaciones c JOIN periodos p USING (periodo_id) WHERE p.anio <> c.anio`,
    "registrada=1 sin valor": "SELECT COUNT(*) FROM calificaciones WHERE registrada = 1 AND (valor_fuente IS NULL OR valor_fuente = '')",
  };
  for (const [nombre, sql] of Object.entries(huerfanos)) registrar(`huérfanos ${nombre}`, 0, await uno(ro, sql));

  // 4. La correspondencia privada NO está en ninguna base
  const [prohibidas] = await ro.query<RowDataPacket[]>(
    `SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN (?)`,
    [esperados.tablas_prohibidas],
  );
  registrar("tablas privadas visibles", [], prohibidas.map((r) => `${r.table_schema}.${r.table_name}`));

  // 5. Permisos: app_ro no puede escribir; app_exp no puede tocar el origen
  const debeFallar = async (c: mysql.Connection, sql: string) => {
    try { await c.query(sql); return "PERMITIDO"; } catch { return "DENEGADO"; }
  };
  registrar("app_ro INSERT en origen", "DENEGADO",
    await debeFallar(ro, "INSERT INTO ciclos (anio, nombre) VALUES (2099, 'x')"));
  await ro.end();

  const exp = await conexion(process.env.MYSQL_EXP_USER ?? "app_exp", process.env.MYSQL_EXP_PASSWORD, DB_EXP);
  registrar("app_exp lectura de origen", "DENEGADO",
    await debeFallar(exp, `SELECT 1 FROM \`${DB_ORIGEN}\`.estudiantes LIMIT 1`));
  registrar("app_exp DROP en laboratorio", "DENEGADO", await debeFallar(exp, "DROP TABLE medicion"));
  await exp.end();

  // Reporte
  const fallos = checks.filter((c) => !c.ok).length;
  mkdirSync(resolve(RAIZ, "artifacts/reports"), { recursive: true });
  writeFileSync(
    resolve(RAIZ, "artifacts/reports/verificacion-origen.json"),
    JSON.stringify({ fecha: new Date().toISOString(), total: checks.length, fallos, checks }, null, 2),
  );
  console.log(`\n${checks.length - fallos}/${checks.length} comprobaciones correctas.`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
