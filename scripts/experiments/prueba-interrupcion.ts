// F6.5 Prueba de interrupción: el servidor muere antes o después de anclar, `pnpm reconcile` deja el
// estado consistente y el reintento del cliente no duplica nada.
// Uso: pnpm prueba:interrupcion   (usa LEDGER y EXPERIMENT_STRATEGY del entorno; requiere puerto 3198 libre)
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";

const PUERTO = 3198;
const BASE = `http://127.0.0.1:${PUERTO}`;
const ESTRATEGIA = process.env.EXPERIMENT_STRATEGY ?? "B";
const auth = { authorization: `Bearer ${process.env.BENCH_TOKEN}` };

const c = { host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), dateStrings: true };
const exp = await mysql.createConnection({ ...c, user: process.env.MYSQL_EXP_USER, password: process.env.MYSQL_EXP_PASSWORD, database: process.env.MYSQL_DB_EXP });
const ro = await mysql.createConnection({ ...c, user: process.env.MYSQL_RO_USER, password: process.env.MYSQL_RO_PASSWORD, database: process.env.MYSQL_DB_ORIGEN });
const [[n]] = await ro.query<RowDataPacket[]>("SELECT calificacion_id id FROM calificaciones WHERE registrada = 1 ORDER BY calificacion_id LIMIT 1");
await ro.end();

function servidor(fallo?: string): ChildProcess {
  return spawn("pnpm", ["exec", "next", "dev", "-p", String(PUERTO)], {
    stdio: "ignore", detached: true,
    env: { ...process.env, NODE_ENV: "development", ...(fallo ? { FALLO_INYECTADO: fallo } : { FALLO_INYECTADO: "" }) },
  });
}
async function listo() {
  const limite = Date.now() + 90000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/v1/autenticacion/sesion`, { method: "DELETE" })).ok) return;
    } catch { /* aún no escucha */ }
    if (Date.now() > limite) throw new Error("next dev no arrancó");
    await new Promise((r) => setTimeout(r, 300));
  }
}
function matar(p: ChildProcess) {
  try { process.kill(-p.pid!, "SIGKILL"); } catch { /* ya murió */ }
}
const crear = (key: string) =>
  fetch(`${BASE}/api/v1/eventos`, { method: "POST", headers: { ...auth, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ tipo: "NOTA", origenId: n!.id }) });

let fallas = 0;
const comprobar = (nombre: string, ok: boolean, detalle?: unknown) => {
  console.log(`${ok ? "✔" : "✘"} ${nombre}${ok ? "" : ` -> ${JSON.stringify(detalle)}`}`);
  if (!ok) fallas++;
};

// BD no ancla: el único punto de corte posible es antes de confirmar.
for (const punto of ESTRATEGIA === "BD" ? ["antes-de-anclar"] : ["antes-de-anclar", "tras-anclar"]) {
  console.log(`\n== Interrupción ${punto} (estrategia ${ESTRATEGIA})`);
  const key = `interrupcion-${randomUUID()}`;
  const s1 = servidor(punto);
  await listo();
  const cortada = await crear(key).then(() => false, () => true);
  matar(s1);
  await new Promise((r) => setTimeout(r, 1000));
  comprobar("el servidor murió sin responder", cortada);

  const [[op]] = await exp.query<RowDataPacket[]>("SELECT evento_id, estado FROM operacion WHERE idempotency_key = ?", [key]);
  comprobar("la operación quedó en la bandeja", ["PENDIENTE", "ENVIADA"].includes(op?.estado), op);

  const rec = spawnSync("pnpm", ["-s", "reconcile", "--antiguedad=0"], { encoding: "utf8", env: process.env });
  comprobar("la conciliación termina bien", rec.status === 0, rec.stderr);

  const [[fin]] = await exp.query<RowDataPacket[]>(
    "SELECT o.estado, e.estado_confirmacion ec, o.mensaje_ledger m FROM operacion o JOIN evento e USING (evento_id) WHERE o.evento_id = ?", [op!.evento_id]);
  comprobar("queda CONFIRMADA y sin mensaje pendiente", fin!.estado === "CONFIRMADA" && fin!.ec === "CONFIRMADO" && fin!.m === null, fin);

  const s2 = servidor();
  await listo();
  const r = await crear(key);
  const cuerpo = (await r.json()) as { data?: { eventoId: string; estadoOperacion: string } };
  comprobar("el reintento devuelve el mismo evento", r.status === 201 && cuerpo.data?.eventoId === op!.evento_id && r.headers.get("idempotent-replayed") === "true", cuerpo);
  const [[cuenta]] = await exp.query<RowDataPacket[]>("SELECT COUNT(*) n FROM operacion WHERE idempotency_key = ?", [key]);
  comprobar("no hay duplicados", Number(cuenta!.n) === 1, cuenta);

  const v = await fetch(`${BASE}/api/v1/trazabilidad/${op!.evento_id}/verificar`, { method: "POST", headers: { ...auth, "idempotency-key": `v-${randomUUID()}` } });
  const res = ((await v.json()) as { data: { resultado: string } }).data.resultado;
  comprobar("la verificación es coherente", res === (ESTRATEGIA === "BD" ? "SIN_EVIDENCIA" : "OK"), res);
  matar(s2);
  await new Promise((r) => setTimeout(r, 1000));
}

await exp.end();
console.log(fallas ? `\n${fallas} comprobación(es) fallaron` : "\nPrueba de interrupción correcta");
process.exit(fallas ? 1 : 0);
