"use client";
import { useState } from "react";
import { Aviso, Id, Paginador } from "@/shared/components/ui";
import { useDatos } from "@/shared/components/cliente";
import type { RespuestaPaginada } from "@/shared/types/api";

type Vista = "estudiantes" | "calificaciones" | "asistencias";
type Fila = Record<string, string | number | boolean | null | number[]>;
interface Catalogo { secciones: { seccionId: string; anio: number; nivel: string | null; grado: string; seccion: string }[] }
const ANIOS = [2026, 2025, 2024];

export default function Academico() {
  const [vista, setVista] = useState<Vista>("calificaciones");
  const [anio, setAnio] = useState(2026);
  const [seccion, setSeccion] = useState("");
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ page: String(page), pageSize: "50", anio: String(anio), ...(seccion ? { seccion } : {}) });
  const { datos, error, cargando } = useDatos<RespuestaPaginada<Fila>>(`/academico/${vista}?${q}`);
  const cat = useDatos<{ data: Catalogo }>(`/academico/catalogo?anio=${anio}`);

  return (
    <div className="lamina">
      <h1>Registros académicos</h1>
      <p className="intro">Consulta de la copia de origen. Nada de lo que se hace aquí la modifica.</p>
      <div className="pestanas">
        {(["calificaciones", "asistencias", "estudiantes"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={vista === v} onClick={() => { setVista(v); setPage(1); }}>{v[0]!.toUpperCase() + v.slice(1)}</button>
        ))}
      </div>
      <div className="filtros">
        <label>Año<select value={anio} onChange={(e) => { setAnio(Number(e.target.value)); setSeccion(""); setPage(1); }}>{ANIOS.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>Sección<select value={seccion} onChange={(e) => { setSeccion(e.target.value); setPage(1); }}>
          <option value="">Todas</option>
          {cat.datos?.data.secciones.map((s) => <option key={s.seccionId} value={s.seccionId}>{[s.nivel, s.grado, s.seccion].filter(Boolean).join(" ")}</option>)}
        </select></label>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {cargando && !datos && <p>Cargando…</p>}
      {datos && (datos.data.length === 0
        ? <p>No hay filas con estos filtros. Prueba con otro año o sección.</p>
        : <>
          <div className="tabla"><table>
            {vista === "calificaciones" && <><thead><tr><th>Estudiante</th><th>Asignatura</th><th>Periodo</th><th>Valor</th><th>Registrada</th></tr></thead>
              <tbody>{datos.data.map((f) => <tr key={String(f.calificacionId)}><td><Id valor={String(f.estudianteId)} /></td><td>{String(f.asignatura)}</td><td>{String(f.periodoId)}</td><td>{f.valorFuente === null ? "Vacío" : String(f.valorFuente)}</td><td>{f.registrada ? "Sí" : "No"}</td></tr>)}</tbody></>}
            {vista === "asistencias" && <><thead><tr><th>Estudiante</th><th>Fecha</th><th>Estado</th></tr></thead>
              <tbody>{datos.data.map((f) => <tr key={String(f.asistenciaId)}><td><Id valor={String(f.estudianteId)} /></td><td>{String(f.fecha)}</td><td>{String(f.estado)}</td></tr>)}</tbody></>}
            {vista === "estudiantes" && <><thead><tr><th>Estudiante</th><th className="num">Matrículas</th><th>Años</th></tr></thead>
              <tbody>{datos.data.map((f) => <tr key={String(f.estudianteId)}><td><Id valor={String(f.estudianteId)} /></td><td className="num">{String(f.matriculas)}</td><td>{(f.anios as number[]).join(", ")}</td></tr>)}</tbody></>}
          </table></div>
          <Paginador meta={datos.meta} ir={setPage} />
        </>)}
    </div>
  );
}
