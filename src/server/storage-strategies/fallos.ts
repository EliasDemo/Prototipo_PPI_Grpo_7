import "server-only";

// Inyección de fallos para la prueba de interrupción (F6.5). Nunca actúa con NODE_ENV=production.
// FALLO_INYECTADO=antes-de-anclar | tras-anclar: el proceso muere en ese punto, como un kill -9.
export function falloInyectado(punto: "antes-de-anclar" | "tras-anclar"): void {
  if (process.env.NODE_ENV !== "production" && process.env.FALLO_INYECTADO === punto) {
    console.error(`[fallos] interrupción inyectada: ${punto}`);
    process.exit(137);
  }
}
