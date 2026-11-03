// F7.4 Busca en el ledger y en los CSV exportados datos que nunca deben estar allí:
// identificadores del origen, claves HMAC y, si se indica, una lista de nombres que no entra al repositorio.
// Uso: pnpm privacidad:auditar [--nombres=/ruta/fuera/del/repo.txt] [--bloques=/ruta/ledger] [--salida=artifacts/reports/auditoria-privacidad.json]
// Código de salida 1 si hay coincidencias. Nunca imprime el valor encontrado, solo dónde y de qué tipo.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { consultar, cerrarFabric } from "@/server/fabric/gateway";
import { cerrarPools, query } from "@/server/mysql/pool";
import { env } from "@/server/config/env";

const opcion = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const CLAVES_VETADAS = /"(nombres?|apellidos?|dni|documento|estudiante|estudianteid|alumno|correo|email|telefono|direccion|valorfuente|valornumerico|origenid)"\s*:/gi;
const ID_ORIGEN = /\b(EST|NOT|ASI|MAT|OFE|SEC|ASG|FUE)-[0-9A-F]{20}\b/g;

interface Hallazgo { lugar: string; tipo: string; veces: number }
const hallazgos: Hallazgo[] = [];
const contar = (t: string, r: RegExp) => (t.match(r) ?? []).length;

const claves = await query<{ c: string }>("exp", "SELECT LOWER(HEX(clave)) c FROM evento_clave");
const nombresArchivo = opcion("nombres");
const nombres = nombresArchivo ? readFileSync(nombresArchivo, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length >= 3) : [];

function revisar(lugar: string, texto: string, esLedgerA = false) {
  const id = contar(texto, ID_ORIGEN);
  if (id) hallazgos.push({ lugar, tipo: "identificador-origen", veces: id });
  // En A, las claves del contenido sintético replican la estructura (valorFuente, etc.) con valores al azar.
  if (!esLedgerA) {
    const k = contar(texto, CLAVES_VETADAS);
    if (k) hallazgos.push({ lugar, tipo: "campo-identificable", veces: k });
  }
  const bajo = texto.toLowerCase();
  const claveHallada = claves.filter(({ c }) => bajo.includes(c)).length;
  if (claveHallada) hallazgos.push({ lugar, tipo: "clave-hmac", veces: claveHallada });
  const nombreHallado = nombres.filter((n) => bajo.includes(n.toLowerCase())).length;
  if (nombreHallado) hallazgos.push({ lugar, tipo: "nombre", veces: nombreHallado });
}

// 1. Ledger: el estado de cada registro.
const registros = await query<{ registro_id: string; estrategia: string }>("exp", "SELECT registro_id, estrategia FROM registro WHERE estrategia <> 'BD'");
let revisados = 0;
if (env().LEDGER === "fabric") {
  for (const r of registros) {
    revisar(`ledger:${r.registro_id}`, await consultar("HistorialRegistro", r.registro_id), r.estrategia === "A");
    revisados++;
  }
} else {
  const filas = await query<Record<string, unknown>>("exp", "SELECT * FROM ledger_simulado");
  revisar("ledger_simulado", JSON.stringify(filas));
  revisados = filas.length;
}

// 2. Archivos: CSV de resultados y, si se indica, los bloques crudos del peer.
function archivos(dir: string, filtro: (f: string) => boolean): string[] {
  let hijos: string[];
  try { hijos = readdirSync(dir); } catch { return []; }
  return hijos.flatMap((h) => {
    const f = join(dir, h);
    return statSync(f).isDirectory() ? archivos(f, filtro) : filtro(f) ? [f] : [];
  });
}
const csvs = archivos("artifacts/results", (f) => f.endsWith(".csv"));
for (const f of csvs) revisar(f, readFileSync(f, "utf8"));
const bloques = opcion("bloques");
const crudos = bloques ? archivos(bloques, (f) => /blockfile_/.test(f)) : [];
for (const f of crudos) {
  // Los bloques incluyen el contenido sintético de A, así que aquí no se revisan los nombres de campo.
  revisar(f, readFileSync(f).toString("latin1"), true);
}

const reporte = {
  fecha: new Date().toISOString(),
  revisado: { registrosLedger: revisados, csv: csvs.length, bloques: crudos.length, clavesComparadas: claves.length, nombresComparados: nombres.length },
  coincidencias: hallazgos.reduce((s, h) => s + h.veces, 0),
  hallazgos,
};
const salida = opcion("salida") ?? "artifacts/reports/auditoria-privacidad.json";
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(reporte, null, 2));
console.log(JSON.stringify(reporte, null, 2));
await cerrarFabric();
await cerrarPools();
process.exit(reporte.coincidencias ? 1 : 0);
