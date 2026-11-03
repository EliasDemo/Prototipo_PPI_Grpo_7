"use client";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/shared/components/ui";

export default function Acceso() {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/autenticacion/sesion", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ usuario: f.get("usuario"), password: f.get("password") }),
      });
      if (r.ok) return window.location.assign("/datos");
      setError(r.status === 401 ? "Usuario o contraseña incorrectos." : "El servidor no pudo iniciar la sesión. Inténtalo de nuevo.");
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
    setEnviando(false);
  }

  return (
    <main className="acceso">
      <form onSubmit={entrar}>
        <h1>Trazabilidad académica</h1>
        <label>Usuario<input name="usuario" autoComplete="username" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <Aviso>{error}</Aviso>}
        <button className="principal" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
