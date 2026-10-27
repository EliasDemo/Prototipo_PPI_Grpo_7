// Serialización determinista de JSON (F3.2), compatible con el subconjunto entero de RFC 8785 (JCS):
//  - claves de objeto ordenadas recursivamente por unidades UTF-16 (orden por defecto de JS);
//  - sin espacios; strings con el escape estándar de JSON;
//  - solo enteros seguros como números. Los decimales van como texto exacto ("18.5000"),
//    así no hay floats ni redondeos y el DECIMAL(10,4) del origen se conserva tal cual;
//  - se rechaza lo que JSON.stringify ocultaría o transformaría: undefined, NaN, ±Infinity,
//    -0, Date, Map, Buffer, funciones, instancias de clase y arreglos con huecos.

export const SCHEMA_VERSION = 1;

export class ErrorCanonico extends Error {}

function falla(ruta: string, motivo: string): never {
  throw new ErrorCanonico(`${ruta || "(raíz)"}: ${motivo}`);
}

function esObjetoPlano(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function serializar(v: unknown, ruta: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return v.toString();
    case "number":
      if (!Number.isFinite(v)) return falla(ruta, `número no finito (${v})`);
      if (Object.is(v, -0)) return falla(ruta, "-0 no es canónico");
      if (!Number.isSafeInteger(v)) return falla(ruta, `${v} no es un entero seguro; use texto decimal`);
      return String(v);
    case "undefined":
      return falla(ruta, "undefined no es serializable");
    case "object":
      break;
    default:
      return falla(ruta, `tipo ${typeof v} no es serializable`);
  }

  if (Array.isArray(v)) {
    const partes: string[] = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) falla(`${ruta}[${i}]`, "arreglo con huecos");
      partes.push(serializar(v[i], `${ruta}[${i}]`));
    }
    return `[${partes.join(",")}]`;
  }
  if (!esObjetoPlano(v)) {
    const nombre = (v as object).constructor?.name ?? "desconocido";
    return falla(ruta, `${nombre} no es un objeto plano; conviértalo antes (p. ej. Date -> ISO string)`);
  }
  if (Object.getOwnPropertySymbols(v).length) falla(ruta, "claves symbol no son serializables");
  const claves = Object.keys(v).sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${serializar(v[k], ruta ? `${ruta}.${k}` : k)}`).join(",")}}`;
}

/** Texto canónico de cualquier valor JSON admitido. */
export function canonical(valor: unknown): string {
  return serializar(valor, "");
}

/** Serialización versionada: agrega `schemaVersion` y devuelve los bytes UTF-8 que se firman. */
export function serializarVersionado(contenido: Record<string, unknown>): Buffer {
  if ("schemaVersion" in contenido) throw new ErrorCanonico("schemaVersion lo agrega el serializador");
  return Buffer.from(canonical({ ...contenido, schemaVersion: SCHEMA_VERSION }), "utf8");
}

/** DECIMAL(10,4): hasta 6 dígitos enteros y 4 decimales, como texto. */
export const DECIMAL_10_4 = /^-?\d{1,6}(\.\d{1,4})?$/;
