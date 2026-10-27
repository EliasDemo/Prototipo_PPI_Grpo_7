// Se ejecuta una vez al arrancar el servidor: si .env es inválido, Next no arranca.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/server/config/env");
    env();
  }
}
