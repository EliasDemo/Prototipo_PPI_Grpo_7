"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Aviso, Estado, Id, fechaLocal } from "@/shared/components/ui";
import { enviar, useDatos } from "@/shared/components/cliente";
import type { RespuestaPaginada } from "@/shared/types/api";

interface Eslabon { eventoId: string; version: number; operacion: string; actor: string; fechaExperimental: string; estadoOperacion: string | null; detallePresente: boolean }
interface Traza {
  registro: { registroId: string; tipo: string; estrategia: string; estadoVigencia: string; estadoDetalle: string; versionActual: number };
  cadena: Eslabon[];
  revocacion: { motivoCodigo: string; estado: string; fecha: string } | null;
  enlacesValidos: boolean;
}
interface Verificacion { resultado: string; detalles: string[] }
const OPERACIONES: Record<string, string> = { CREAR: "Creación", RECTIFICAR: "Rectificación", SUPRIMIR: "Supresión" };

function Nudo({ e }: { e: Eslabon }) {
  const [v, setV] = useState<Verificacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function verificar() {
    setOcupado(true);
    setError(null);
    try {
      setV((await enviar<{ data: Verificacion }>(`/trazabilidad/${e.eventoId}/verificar`)).data);
    } catch (err) {
      setError((err as Error).message);
    }
    setOcupado(false);
  }
  return (
    <li className={`nudo ${e.operacion === "SUPRIMIR" ? "suprimir" : ""}`}>
      <span className="numero" aria-label={`Versión ${e.version}`}>{e.version}</span>
      <div className="ficha">
        <div className="cabeza"><h3>{OPERACIONES[e.operacion] ?? e.operacion}</h3><Estado valor={e.estadoOperacion} /></div>
        <div className="tenue">{fechaLocal(e.fechaExperimental)}, rol {e.actor}, evento <Id valor={e.eventoId} /></div>
        <div className="acciones">
          <button type="button" disabled={ocupado} onClick={verificar}>{ocupado ? "Verificando…" : "Verificar"}</button>
          {v && <Estado valor={v.resultado} />}
        </div>
        {v && <ul>{v.detalles.map((d) => <li key={d}>{d}</li>)}</ul>}
        {error && <Aviso>{error}</Aviso>}
      </div>
    </li>
  );
}

function Detalle({ id }: { id: string }) {
  const { datos, error } = useDatos<{ data: Traza }>(`/trazabilidad/${id}`);
  if (error) return <Aviso>{error}</Aviso>;
  if (!datos) return <p>Cargando…</p>;
  const t = datos.data;
  return <>
    <h2>Registro <Id valor={t.registro.registroId} /></h2>
    <p>{t.registro.tipo === "NOTA" ? "Nota" : "Asistencia"}, estrategia {t.registro.estrategia}. <Estado valor={t.registro.estadoVigencia} />. Detalle: <Estado valor={t.registro.estadoDetalle} />.</p>
    {!t.enlacesValidos && <Aviso>La cadena de versiones está rota: hay versiones que no enlazan con la anterior.</Aviso>}
    {t.revocacion && <p>Revocado el {fechaLocal(t.revocacion.fecha)}, motivo {t.revocacion.motivoCodigo}. Estado en el ledger: <Estado valor={t.revocacion.estado} />.</p>}
    <ol className="hilo">{t.cadena.map((e) => <Nudo key={e.eventoId} e={e} />)}</ol>
  </>;
}

function Vista() {
  const id = useSearchParams().get("registro");
  const { datos, error } = useDatos<RespuestaPaginada<{ registroId: string; tipo: string; versionActual: number; estadoVigencia: string; estadoDetalle: string }>>("/trazabilidad?pageSize=20");
  return (
    <div className="lamina">
      <h1>Trazabilidad</h1>
      <p className="intro">Cada versión de un registro y lo que el ledger dice de ella.</p>
      {id ? <Detalle key={id} id={id} /> : <>
        {error && <Aviso>{error}</Aviso>}
        {datos?.data.length === 0 && <p>No hay registros todavía. <Link href="/laboratorio">Crea una copia en el laboratorio.</Link></p>}
        {!!datos?.data.length && <div className="tabla"><table>
          <thead><tr><th>Registro</th><th>Tipo</th><th className="num">Versiones</th><th>Vigencia</th><th>Detalle</th></tr></thead>
          <tbody>{datos.data.map((r) => <tr key={r.registroId}><td><Link href={`/trazabilidad?registro=${r.registroId}`}><Id valor={r.registroId} /></Link></td><td>{r.tipo === "NOTA" ? "Nota" : "Asistencia"}</td><td className="num">{r.versionActual}</td><td><Estado valor={r.estadoVigencia} /></td><td><Estado valor={r.estadoDetalle} /></td></tr>)}</tbody>
        </table></div>}
      </>}
      {id && <p><Link href="/trazabilidad">Ver todos los registros</Link></p>}
    </div>
  );
}

export default function Trazabilidad() {
  return <Suspense fallback={<p>Cargando…</p>}><Vista /></Suspense>;
}
