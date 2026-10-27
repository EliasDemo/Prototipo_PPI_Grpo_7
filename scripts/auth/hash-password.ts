// Genera OPERADOR_PASSWORD_HASH para .env.
// Uso: pnpm auth:hash            (pide la contraseña sin mostrarla)
//      echo -n 'clave' | pnpm auth:hash
import { hashPassword } from "../../src/modules/autenticacion/password.ts";

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const p of process.stdin) partes.push(p as Buffer);
  return Buffer.concat(partes).toString("utf8").replace(/\r?\n$/, "");
}

async function preguntarOculto(): Promise<string> {
  process.stdout.write("Contraseña del operador: ");
  process.stdin.setRawMode(true);
  let valor = "";
  for await (const trozo of process.stdin) {
    for (const c of (trozo as Buffer).toString("utf8")) {
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        return valor;
      }
      if (c === "\u0003") process.exit(130);
      valor = c === "\u007f" ? valor.slice(0, -1) : valor + c;
    }
  }
  return valor;
}

const clave = process.stdin.isTTY ? await preguntarOculto() : await leerStdin();
if (clave.length < 10) {
  console.error("La contraseña debe tener al menos 10 caracteres.");
  process.exit(1);
}
console.log(`OPERADOR_PASSWORD_HASH=${await hashPassword(clave)}`);
process.exit(0);
