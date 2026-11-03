"use client";
import { Aviso, Estado } from "@/shared/components/ui";
import { useDatos } from "@/shared/components/cliente";

type Corrida = Record<string, string | number | null> & { corrida_id: string };
const ms = (v: unknown) => (v === null || v === undefined ? "Sin dato" : Number(v).toLocaleString("es-PE", { maximumFractionDigits: 1 }));

export default function Experimentos() {
  const { datos, error } = useDatos<{ data: Corrida[] }>("/experimentos/corridas");
  return (
    <div className="lamina">
      <h1>Experimentos</h1>
      <p className="intro">Corridas del benchmark y sus mediciones por operación. Las mediciones no incluyen identificadores de registros.</p>
      <div className="acciones">
        <a href="/api/v1/experimentos/mediciones?formato=csv" download>Descargar todas en CSV</a>
        <a href="/api/v1/experimentos/mediciones?formato=json" download>Descargar todas en JSON</a>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {datos?.data.length === 0 && <p>Aún no hay corridas. Se crean al ejecutar <code>pnpm bench</code>.</p>}
      {!!datos?.data.length && <><h2>Corridas</h2><div className="tabla"><table>
        <thead><tr><th>Estrategia</th><th>Carga</th><th className="num">Op/s</th><th className="num">Repetición</th><th>Estado</th><th className="num">Solicitudes</th><th className="num">Confirmadas</th><th className="num">Latencia media (ms)</th><th>Descargar</th></tr></thead>
        <tbody>{datos.data.map((c) => <tr key={c.corrida_id}>
          <td>{c.estrategia}</td><td>{c.carga}</td><td className="num">{c.tps_ofrecido}</td><td className="num">{c.repeticion}</td><td><Estado valor={String(c.estado)} /></td>
          <td className="num">{c.solicitudes ?? 0}</td><td className="num">{c.confirmadas ?? 0}</td><td className="num">{ms(c.t_total_prom_ms)}</td>
          <td><a href={`/api/v1/experimentos/mediciones?corrida=${c.corrida_id}&formato=csv`} download>CSV</a>, <a href={`/api/v1/experimentos/mediciones?corrida=${c.corrida_id}&formato=json`} download>JSON</a></td>
        </tr>)}</tbody>
      </table></div></>}
    </div>
  );
}
