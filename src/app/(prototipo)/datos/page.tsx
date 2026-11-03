"use client";
import { Aviso } from "@/shared/components/ui";
import { useDatos } from "@/shared/components/cliente";

interface Resumen {
  conteos: Record<string, number>;
  anios: { anio: number; nombre: string; matriculas: number; asistencias: number; calificaciones: number; calificacionesRegistradas: number }[];
  fuentes: { fuenteId: string; archivo: string; tipo: string; anio: number; filasFuente: number }[];
  diferencias: { controlId: number; anio: number; grupo: string; tipo: string; estadoCodigo: string | null; extraido: number; totalFuente: number; diferencia: number }[];
}
const n = (v: number) => v.toLocaleString("es-PE");
const NOMBRES: Record<string, string> = {
  estudiantes: "Estudiantes", matriculas: "Matrículas", asistencias: "Asistencias", calificaciones: "Celdas de notas",
  calificacionesRegistradas: "Notas registradas", secciones: "Secciones", asignaturas: "Asignaturas", ofertas: "Ofertas", periodos: "Periodos", fuentes: "Archivos fuente",
};

export default function Datos() {
  const { datos, error } = useDatos<{ data: Resumen }>("/datos/resumen");
  if (error) return <Aviso>{error}</Aviso>;
  if (!datos) return <p>Cargando…</p>;
  const d = datos.data;
  return (
    <div className="lamina">
      <h1>Datos de origen</h1>
      <p className="intro">Copia seudonimizada, de solo lectura. Las notas son bimestrales y las asistencias, diarias; no hay evaluaciones individuales.</p>
      <dl className="conteos">
        {Object.entries(NOMBRES).map(([k, t]) => <div key={k}><dt>{t}</dt><dd>{n(d.conteos[k] ?? 0)}</dd></div>)}
      </dl>
      <h2>Cobertura por año</h2>
      <div className="tabla"><table>
        <thead><tr><th>Año</th><th className="num">Matrículas</th><th className="num">Asistencias</th><th className="num">Celdas de notas</th><th className="num">Notas registradas</th></tr></thead>
        <tbody>{d.anios.map((a) => <tr key={a.anio}><td>{a.anio}</td><td className="num">{n(a.matriculas)}</td><td className="num">{n(a.asistencias)}</td><td className="num">{n(a.calificaciones)}</td><td className="num">{n(a.calificacionesRegistradas)}</td></tr>)}</tbody>
      </table></div>
      <h2>Diferencias entre subtotales y celdas</h2>
      <p>Se conservan como incidencias de la extracción; la fuente no se corrige.</p>
      <div className="tabla"><table>
        <thead><tr><th>Año</th><th>Grupo</th><th>Tipo</th><th>Estado</th><th className="num">Extraído</th><th className="num">Total fuente</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{d.diferencias.map((x) => <tr key={x.controlId}><td>{x.anio}</td><td>{x.grupo}</td><td>{x.tipo}</td><td>{x.estadoCodigo ?? "Sin dato"}</td><td className="num">{n(x.extraido)}</td><td className="num">{n(x.totalFuente)}</td><td className="num">{n(x.diferencia)}</td></tr>)}</tbody>
      </table></div>
      <h2>Archivos fuente</h2>
      <div className="tabla"><table>
        <thead><tr><th>Archivo</th><th>Tipo</th><th>Año</th><th className="num">Filas</th></tr></thead>
        <tbody>{d.fuentes.map((f) => <tr key={f.fuenteId}><td>{f.archivo}</td><td>{f.tipo}</td><td>{f.anio}</td><td className="num">{n(f.filasFuente)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
