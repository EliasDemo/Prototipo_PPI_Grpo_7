// Cierre F2: mide p50/p95/p99 de las rutas de consulta con pageSize=50 contra un servidor en marcha.
// Uso: pnpm build && pnpm start   (otra terminal)
//      pnpm latencia:api [--base http://localhost:3000] [--n 200] [--concurrencia 4]
// Salida: artifacts/reports/latencia-api-f2.json · código 1 si algún p95 >= 300 ms.
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: { base: { type: "string", default: "http://localhost:3000" }, n: { type: "string", default: "200" }, concurrencia: { type: "string", default: "4" } },
});
const BASE = `${a.base}/api/v1`;
const N = Number(a.n);
const CONC = Number(a.concurrencia);
const UMBRAL_P95_MS = 300;
const headers = { authorization: `Bearer ${process.env.BENCH_TOKEN}` };

// Semilla fija: mismas páginas en cada ejecución.
let semilla = Number(process.env.EXPERIMENT_SEED ?? 20261027);
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pagina = (total: number) => 1 + Math.floor(azar() * Math.ceil(total / 50));

async function get<T>(ruta: string): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, { headers });
  if (!r.ok) throw new Error(`${ruta} -> ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

type Cat = { data: { secciones: { seccionId: string; anio: number }[] } };
const cat = await get<Cat>("/academico/catalogo");
const secciones = cat.data.secciones;
const sec = () => secciones[Math.floor(azar() * secciones.length)]!;
const est = (await get<{ data: { estudianteId: string }[] }>("/academico/estudiantes?pageSize=200")).data.map((e) => e.estudianteId);

// Cada escenario genera la URL de una solicitud (páginas al azar, incluidas las últimas).
const ESCENARIOS: Record<string, () => string> = {
  "datos/resumen": () => "/datos/resumen",
  "academico/catalogo": () => "/academico/catalogo",
  "academico/estudiantes": () => `/academico/estudiantes?pageSize=50&page=${pagina(552)}`,
  "academico/estudiantes?anio&seccion": () => { const s = sec(); return `/academico/estudiantes?anio=${s.anio}&seccion=${s.seccionId}&pageSize=50`; },
  "academico/estudiantes/:id": () => `/academico/estudiantes/${est[Math.floor(azar() * est.length)]}`,
  "academico/calificaciones": () => `/academico/calificaciones?pageSize=50&page=${pagina(24676)}`,
  "academico/calificaciones?registrada&periodo": () => `/academico/calificaciones?registrada=true&periodo=PER-2026-${1 + Math.floor(azar() * 4)}&pageSize=50&page=${pagina(2800)}`,
  "academico/asistencias": () => `/academico/asistencias?pageSize=50&page=${pagina(142882)}`,
  "academico/asistencias?anio&desde&hasta": () => `/academico/asistencias?anio=2025&desde=2025-03-01&hasta=2025-12-31&pageSize=50&page=${pagina(60000)}`,
  "academico/asistencias?seccion": () => `/academico/asistencias?seccion=${sec().seccionId}&pageSize=50&page=${pagina(2500)}`,
};

const percentil = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

const resultados = [];
for (const [nombre, url] of Object.entries(ESCENARIOS)) {
  for (let i = 0; i < 10; i++) await fetch(`${BASE}${url()}`, { headers }); // calentamiento
  const tiempos: number[] = [];
  let errores = 0;
  const urls = Array.from({ length: N }, url);
  await Promise.all(
    Array.from({ length: CONC }, async (_, w) => {
      for (let i = w; i < urls.length; i += CONC) {
        const t0 = performance.now();
        const r = await fetch(`${BASE}${urls[i]}`, { headers });
        await r.arrayBuffer();
        tiempos.push(performance.now() - t0);
        if (!r.ok) errores++;
      }
    }),
  );
  tiempos.sort((x, y) => x - y);
  const fila = {
    ruta: nombre, n: N, errores,
    p50: +percentil(tiempos, 50).toFixed(1), p95: +percentil(tiempos, 95).toFixed(1), p99: +percentil(tiempos, 99).toFixed(1),
    max: +tiempos.at(-1)!.toFixed(1),
  };
  resultados.push(fila);
  console.log(`${fila.p95 < UMBRAL_P95_MS && !errores ? "✔" : "✘"} ${nombre.padEnd(44)} p50 ${String(fila.p50).padStart(6)}  p95 ${String(fila.p95).padStart(6)}  p99 ${String(fila.p99).padStart(6)} ms  errores ${errores}`);
}

const ok = resultados.every((r) => r.p95 < UMBRAL_P95_MS && r.errores === 0);
mkdirSync("artifacts/reports", { recursive: true });
writeFileSync(
  "artifacts/reports/latencia-api-f2.json",
  JSON.stringify({ fecha: new Date().toISOString(), base: a.base, pageSize: 50, n: N, concurrencia: CONC, umbralP95Ms: UMBRAL_P95_MS, ok, resultados }, null, 2),
);
console.log(ok ? `\nTodas las rutas con p95 < ${UMBRAL_P95_MS} ms.` : "\nAlguna ruta no cumple; ver artifacts/reports/latencia-api-f2.json");
process.exit(ok ? 0 : 1);
