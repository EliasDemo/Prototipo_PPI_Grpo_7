import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonical, DECIMAL_10_4, ErrorCanonico, serializarVersionado } from "@/server/crypto/canonical";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// Evento de referencia. Si alguno de estos vectores cambia, cambió el formato de firma:
// hay que subir SCHEMA_VERSION, no editar el vector.
const EVENTO_REF = {
  eventoId: "00000000-0000-4000-8000-000000000001",
  registroId: "00000000-0000-4000-8000-000000000002",
  version: 1,
  operacion: "CREAR",
  prevEventoId: null,
  payload: {
    tipo: "NOTA", anio: 2026, periodoId: "PER-2026-1", ofertaId: "OFE-84F519C6DF671A1B425A",
    asignaturaId: "ASG-081C870E381DFF082C9E", seccionId: "SEC-00ED1D59363A88B2AE2F",
    valorFuente: "AD", valorNumerico: "18.5000", registrada: true, nivelAgregacion: "bimestral", motivo: null,
  },
};
const TEXTO_REF =
  '{"eventoId":"00000000-0000-4000-8000-000000000001","operacion":"CREAR","payload":{"anio":2026,' +
  '"asignaturaId":"ASG-081C870E381DFF082C9E","motivo":null,"nivelAgregacion":"bimestral",' +
  '"ofertaId":"OFE-84F519C6DF671A1B425A","periodoId":"PER-2026-1","registrada":true,' +
  '"seccionId":"SEC-00ED1D59363A88B2AE2F","tipo":"NOTA","valorFuente":"AD","valorNumerico":"18.5000"},' +
  '"prevEventoId":null,"registroId":"00000000-0000-4000-8000-000000000002","schemaVersion":1,"version":1}';
const SHA_REF = "4300431f10d83d8b0bf97a844532de5a4e6ae089de24f9f6c22dbe5af226cd88";

describe("vectores de referencia", () => {
  it("orden por unidades UTF-16 y escapes JSON", () => {
    expect(canonical({ z: 1, a: { y: [3, "x", null, true], b: 'ñ"\n' }, é: false, A: "18.5000" })).toBe(
      '{"A":"18.5000","a":{"b":"ñ\\"\\n","y":[3,"x",null,true]},"z":1,"é":false}',
    );
  });

  it("evento versionado: texto y SHA-256 fijos", () => {
    const bytes = serializarVersionado(EVENTO_REF);
    expect(bytes.toString("utf8")).toBe(TEXTO_REF);
    expect(sha256(TEXTO_REF)).toBe(SHA_REF);
    expect(sha256(bytes)).toBe(SHA_REF);
  });
});

describe("determinismo", () => {
  it("las mismas claves en otro orden dan los mismos bytes", () => {
    const invertido: Record<string, unknown> = Object.fromEntries(Object.entries(EVENTO_REF).reverse());
    invertido.payload = Object.fromEntries(Object.entries(EVENTO_REF.payload).reverse());
    expect(serializarVersionado(invertido).equals(serializarVersionado(EVENTO_REF))).toBe(true);
  });

  it("sobrevive a un viaje JSON (como el de la columna JSON de MySQL)", () => {
    expect(canonical(JSON.parse(JSON.stringify(EVENTO_REF)))).toBe(canonical(EVENTO_REF));
  });

  it("el orden de los arreglos sí importa", () => {
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it("el decimal como texto se conserva exacto", () => {
    expect(canonical({ v: "18.5000" })).not.toBe(canonical({ v: "18.5" }));
  });
});

describe("rechazos", () => {
  it.each([
    ["undefined en propiedad", { a: undefined }],
    ["undefined en arreglo", [undefined]],
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
    ["-0", { a: -0 }],
    ["float", { a: 18.5 }],
    ["entero inseguro", { a: 2 ** 53 }],
    ["Date", { a: new Date(0) }],
    ["Map", { a: new Map() }],
    ["Buffer", { a: Buffer.from("x") }],
    ["función", { a: () => 1 }],
    ["symbol", { a: Symbol("x") }],
    ["clave symbol", { [Symbol("x")]: 1 }],
    ["arreglo con huecos", new Array(3)],
    ["instancia de clase", new (class Foo { x = 1; })()],
  ])("%s", (_, valor) => {
    expect(() => canonical(valor)).toThrow(ErrorCanonico);
  });

  it("schemaVersion lo pone el serializador", () => {
    expect(() => serializarVersionado({ schemaVersion: 2 })).toThrow(ErrorCanonico);
  });

  it("indica la ruta del valor inválido", () => {
    expect(() => canonical({ payload: { notas: [1, 2.5] } })).toThrow(/payload\.notas\[1\]/);
  });
});

describe("DECIMAL(10,4)", () => {
  it.each(["0", "18", "18.5", "18.5000", "-3.25", "999999.9999"])("acepta %s", (v) => expect(DECIMAL_10_4.test(v)).toBe(true));
  it.each(["", "1e3", "18.50000", "1234567", ".5", "5.", "NaN", "18,5"])("rechaza %s", (v) => expect(DECIMAL_10_4.test(v)).toBe(false));
});
