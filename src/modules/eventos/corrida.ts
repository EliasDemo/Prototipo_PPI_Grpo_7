import "server-only";
import { ErrorApi } from "@/server/http/respuestas";
import { query } from "@/server/mysql/pool";
import { uuid } from "./esquemas";
import type { Confirmacion } from "./tipos";

/** Cabecera X-Corrida-Id (benchmark): debe ser una corrida existente. null si no viene. */
export async function corridaDe(req: Request): Promise<string | null> {
  const id = req.headers.get("x-corrida-id");
  if (id === null) return null;
  if (!uuid.safeParse(id).success) throw new ErrorApi("VALIDACION", "X-Corrida-Id debe ser un UUID");
  const [f] = await query<{ n: number }>("exp", "SELECT COUNT(*) n FROM corrida WHERE corrida_id = ?", [id]);
  if (!Number(f?.n)) throw new ErrorApi("VALIDACION", `No existe la corrida ${id}`);
  return id;
}

/** 201 si la operación quedó CONFIRMADA; 202 si sigue en la bandeja (se concilia después). */
export const statusConfirmacion = (c: Confirmacion) => (c.estadoOperacion === "CONFIRMADA" ? 201 : 202);
