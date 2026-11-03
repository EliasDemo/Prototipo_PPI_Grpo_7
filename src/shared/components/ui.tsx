"use client";
import type { ReactNode } from "react";
import type { MetaPaginacion } from "@/shared/types/api";

const TONOS: Record<string, string> = {
  OK: "bien", CONFIRMADA: "bien", CONFIRMADO: "bien", VIGENTE: "bien", PRESENTE: "bien", TERMINADA: "bien",
  PENDIENTE: "espera", ENVIADA: "espera", TARDIA: "espera", EN_CURSO: "espera", SIN_EVIDENCIA: "espera",
  ALTERADO: "mal", FALLIDA: "mal", FALLIDO: "mal", ABORTADA: "mal",
  REVOCADO: "aparte", RETIRADO: "aparte", DETALLE_RETIRADO: "aparte",
};
const TEXTOS: Record<string, string> = {
  OK: "Coincide con el ledger", ALTERADO: "Alterado", DETALLE_RETIRADO: "Detalle retirado", SIN_EVIDENCIA: "Sin evidencia",
  CONFIRMADA: "Confirmada", CONFIRMADO: "Confirmado", PENDIENTE: "Pendiente", ENVIADA: "Enviada", TARDIA: "Tardía", FALLIDA: "Fallida", FALLIDO: "Fallido",
  VIGENTE: "Vigente", REVOCADO: "Revocado", PRESENTE: "Presente", RETIRADO: "Retirado",
};

export const Estado = ({ valor }: { valor: string | null }) =>
  valor ? <span className={`estado ${TONOS[valor] ?? ""}`}>{TEXTOS[valor] ?? valor}</span> : <span className="tenue">Sin dato</span>;

export const Aviso = ({ tipo = "error", children }: { tipo?: "error" | "exito"; children: ReactNode }) => (
  <p className={`aviso ${tipo}`} role={tipo === "error" ? "alert" : "status"}>{children}</p>
);

export function Paginador({ meta, ir }: { meta: MetaPaginacion; ir: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  return (
    <nav className="paginador" aria-label="Paginación">
      <button type="button" disabled={meta.page <= 1} onClick={() => ir(meta.page - 1)}>Anterior</button>
      <span>Página {meta.page} de {paginas}, {meta.total.toLocaleString("es-PE")} filas</span>
      <button type="button" disabled={meta.page >= paginas} onClick={() => ir(meta.page + 1)}>Siguiente</button>
    </nav>
  );
}

export const Id = ({ valor }: { valor: string }) => <code title={valor}>{valor.length > 16 ? `${valor.slice(0, 8)}…${valor.slice(-4)}` : valor}</code>;

export const fechaLocal = (iso: string) => new Date(iso).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "medium" });
