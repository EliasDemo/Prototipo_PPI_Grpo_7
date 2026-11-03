"use client";
import Link from "next/link";
import { Fragment, useState, type FormEvent } from "react";
import { Aviso, Estado, Id, Paginador, fechaLocal } from "@/shared/components/ui";
import { enviar, useDatos } from "@/shared/components/cliente";
import type { RespuestaPaginada } from "@/shared/types/api";

interface Registro { registroId: string; tipo: "NOTA" | "ASISTENCIA"; estrategia: string; estadoVigencia: string; estadoDetalle: string; versionActual: number; creadoEn: string; estadoOperacion: string | null }
interface Nota { calificacionId: string; asignatura: string; periodoId: string; valorFuente: string | null }
interface Asis { asistenciaId: string; fecha: string; estado: string }

const MOTIVOS: Record<string, string> = {
  PRUEBA_DE_LABORATORIO: "Prueba de laboratorio", ERROR_DE_REGISTRO: "Error de registro", DUPLICADO: "Duplicado",
  ORDEN_ADMINISTRATIVA: "Orden administrativa", SOLICITUD_DEL_TITULAR: "Solicitud del titular",
};
const ESTADOS: Record<string, string> = { ASIST: "Asistencia", TI: "Tardanza injustificada", TJ: "Tardanza justificada", FI: "Falta injustificada", FJ: "Falta justificada", PRM: "Permiso", MCX: "Mala conexión" };

export default function Laboratorio() {
  const [page, setPage] = useState(1);
  const [abierto, setAbierto] = useState<{ id: string; accion: "rectificar" | "revocar" | "suprimir" } | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const regs = useDatos<RespuestaPaginada<Registro>>(`/trazabilidad?page=${page}&pageSize=20`);
  const notas = useDatos<RespuestaPaginada<Nota>>("/academico/calificaciones?anio=2026&registrada=true&pageSize=5");
  const asis = useDatos<RespuestaPaginada<Asis>>("/academico/asistencias?anio=2026&pageSize=5");

  async function accion(fn: () => Promise<unknown>, exito: string) {
    setOcupado(true);
    setMensaje(null);
    try {
      await fn();
      setMensaje({ tipo: "exito", texto: exito });
      setAbierto(null);
      setPage(1);
      await regs.recargar();
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
    setOcupado(false);
  }
  const crear = (tipo: string, origenId: string) => accion(() => enviar("/eventos", { tipo, origenId }), "Copia creada y anclada.");

  function rectificar(e: FormEvent<HTMLFormElement>, r: Registro) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cambios = r.tipo === "NOTA" ? { valorFuente: f.get("valor") } : { estadoCodigo: f.get("estado") };
    void accion(() => enviar(`/eventos/${r.registroId}/rectificaciones`, { versionEsperada: r.versionActual, motivo: f.get("motivo"), cambios }), `Rectificado: ahora está en la versión ${r.versionActual + 1}.`);
  }
  function revocar(e: FormEvent<HTMLFormElement>, r: Registro) {
    e.preventDefault();
    void accion(() => enviar(`/eventos/${r.registroId}/revocaciones`, { motivoCodigo: new FormData(e.currentTarget).get("motivo") }), "Registro revocado. Su contenido se conserva.");
  }

  // El formulario se abre justo debajo de la fila, no al final de una tabla larga.
  function panelDe(r: Registro) {
        if (!abierto) return null;
        const cancelar = <button type="button" onClick={() => setAbierto(null)}>Cancelar</button>;
        if (abierto.accion === "rectificar") return (
          <form className="panel" onSubmit={(e) => rectificar(e, r)}>
            <h3>Rectificar la versión {r.versionActual}</h3>
            {r.tipo === "NOTA"
              ? <label>Valor nuevo<input name="valor" required maxLength={40} /></label>
              : <label>Estado nuevo<select name="estado">{Object.entries(ESTADOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>}
            <label>Motivo. No escribas nombres.<input name="motivo" required maxLength={300} /></label>
            <div className="acciones"><button className="principal" disabled={ocupado}>Guardar rectificación</button>{cancelar}</div>
          </form>);
        if (abierto.accion === "revocar") return (
          <form className="panel" onSubmit={(e) => revocar(e, r)}>
            <h3>Revocar el registro</h3>
            <p>Deja de estar vigente, pero su contenido sigue disponible.</p>
            <label>Motivo<select name="motivo">{Object.entries(MOTIVOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <div className="acciones"><button className="principal" disabled={ocupado}>Revocar</button>{cancelar}</div>
          </form>);
        return (
          <div className="panel">
            <h3>Suprimir el registro</h3>
            <p>Borra el detalle y las claves de las {r.versionActual} versiones y el vínculo con el origen. No se puede deshacer. En el ledger quedan identificadores opacos y huellas; los respaldos no se tocan.</p>
            <div className="acciones">
              <button type="button" className="peligro" disabled={ocupado} onClick={() => accion(() => enviar(`/privacidad/${r.registroId}/supresion`), "Detalle retirado del registro.")}>Suprimir definitivamente</button>{cancelar}
            </div>
          </div>);
  }

  return (
    <div className="lamina">
      <h1>Laboratorio</h1>
      <p className="intro">Las acciones se aplican a copias de ensayo. El origen nunca cambia.</p>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}

      <h2>Crear una copia</h2>
      <div className="tabla"><table>
        <thead><tr><th>Tipo</th><th>Registro de origen</th><th>Valor</th><th></th></tr></thead>
        <tbody>
          {notas.datos?.data.map((n) => <tr key={n.calificacionId}><td>Nota</td><td>{n.asignatura}, {n.periodoId}</td><td>{n.valorFuente ?? "Vacío"}</td><td><button type="button" disabled={ocupado} onClick={() => crear("NOTA", n.calificacionId)}>Crear copia</button></td></tr>)}
          {asis.datos?.data.map((a) => <tr key={a.asistenciaId}><td>Asistencia</td><td>{a.fecha}</td><td>{a.estado}</td><td><button type="button" disabled={ocupado} onClick={() => crear("ASISTENCIA", a.asistenciaId)}>Crear copia</button></td></tr>)}
        </tbody>
      </table></div>

      <h2>Copias de ensayo</h2>
      {regs.error && <Aviso>{regs.error}</Aviso>}
      {regs.datos?.data.length === 0 && <p>Aún no hay copias. Crea la primera desde la tabla de arriba.</p>}
      {!!regs.datos?.data.length && <>
        <div className="tabla"><table>
          <thead><tr><th>Registro</th><th>Tipo</th><th className="num">Versión</th><th>Vigencia</th><th>Detalle</th><th>Última operación</th><th>Creado</th><th>Acciones</th></tr></thead>
          <tbody>{regs.datos.data.map((r) => {
            const activo = r.estadoVigencia === "VIGENTE" && r.estadoDetalle === "PRESENTE";
            return <Fragment key={r.registroId}><tr>
              <td><Link href={`/trazabilidad?registro=${r.registroId}`}><Id valor={r.registroId} /></Link></td>
              <td>{r.tipo === "NOTA" ? "Nota" : "Asistencia"}</td><td className="num">{r.versionActual}</td>
              <td><Estado valor={r.estadoVigencia} /></td><td><Estado valor={r.estadoDetalle} /></td><td><Estado valor={r.estadoOperacion} /></td><td>{fechaLocal(r.creadoEn)}</td>
              <td><div className="acciones">
                <button type="button" disabled={!activo} onClick={() => setAbierto({ id: r.registroId, accion: "rectificar" })}>Rectificar</button>
                <button type="button" disabled={!activo} onClick={() => setAbierto({ id: r.registroId, accion: "revocar" })}>Revocar</button>
                <button type="button" className="peligro" disabled={r.estadoDetalle !== "PRESENTE"} onClick={() => setAbierto({ id: r.registroId, accion: "suprimir" })}>Suprimir</button>
              </div></td>
            </tr>
            {abierto?.id === r.registroId && <tr><td colSpan={8}>{panelDe(r)}</td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
        <Paginador meta={regs.datos.meta} ir={setPage} />
      </>}

    </div>
  );
}
