"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useDatos } from "@/shared/components/cliente";

const VISTAS = [
  ["/datos", "Datos"], ["/academico", "Académico"], ["/laboratorio", "Laboratorio"], ["/trazabilidad", "Trazabilidad"], ["/experimentos", "Experimentos"],
] as const;
const ESTRATEGIAS: Record<string, string> = { A: "A, evento completo en el ledger", B: "B, híbrida", BD: "BD, sin ledger" };

export default function Marco({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  const { datos } = useDatos<{ data: { estrategia: string; ledger: string } }>("/sistema");
  async function salir() {
    await fetch("/api/v1/autenticacion/sesion", { method: "DELETE" });
    window.location.assign("/acceso");
  }
  return (
    <div className="marco">
      <aside className="pizarron">
        <div className="marca">Trazabilidad académica</div>
        <nav aria-label="Vistas">
          {VISTAS.map(([href, texto]) => <Link key={href} href={href} aria-current={ruta === href ? "page" : undefined}>{texto}</Link>)}
        </nav>
        <div className="modo">
          {datos && <div>Estrategia {ESTRATEGIAS[datos.data.estrategia]}<br />Ledger: {datos.data.ledger}</div>}
          <button type="button" onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}
