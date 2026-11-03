// F6.4 Uso: pnpm reconcile [--antiguedad=60] [--max-intentos=5]
import { cerrarFabric } from "@/server/fabric/gateway";
import { cerrarPools } from "@/server/mysql/pool";
import { conciliar } from "@/server/reconciliation/conciliar";

const arg = (n: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split("=")[1]) : d;
};

const r = await conciliar({ antiguedadSeg: arg("antiguedad", 60), maxIntentos: arg("max-intentos", 5) });
console.log(JSON.stringify(r));
await cerrarFabric();
await cerrarPools();
process.exit(r.sinResolver ? 1 : 0);
