'use strict';

// Contrato `trazabilidad` (F4.3). Determinista entre peers:
//  - la fecha es SIEMPRE el timestamp de la transacción (ctx.stub.getTxTimestamp), nunca la del cliente;
//  - sin Date.now() ni Math.random(); los objetos se construyen con un orden de claves fijo;
//  - no se borra nada: rectificar, suprimir y revocar agregan registros nuevos.

const { Contract } = require('fabric-contract-api');

const CLAVE_VERSION = 'registro~version'; // [registroOpacoId, version con 10 dígitos] -> registro
const CLAVE_ID = 'evidencia~id'; // [evidenciaId] -> { registroOpacoId, version }
const CLAVE_REVOCACION = 'revocacion~evidencia'; // [evidenciaId] -> revocación

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HMAC = /^[0-9a-f]{64}$/;
const SCHEMA_VERSIONS = [1];
const VERSION_MAX = 1000000;

/** Operaciones que se encadenan por versión. REVOCAR va por Revocar(), sin crear versión. */
const OPERACIONES = ['CREAR', 'RECTIFICAR', 'SUPRIMIR'];

/** Motivos de revocación: códigos cerrados, nunca texto libre (no puede contener datos personales). */
const MOTIVOS_REVOCACION = ['ERROR_DE_REGISTRO', 'DUPLICADO', 'ORDEN_ADMINISTRATIVA', 'SOLICITUD_DEL_TITULAR', 'PRUEBA_DE_LABORATORIO'];

// Modo B: solo estos campos, todos obligatorios.
const CAMPOS_EVIDENCIA = ['evidenciaId', 'registroOpacoId', 'prevEvidenciaId', 'version', 'operacion', 'hmac', 'schemaVersion'];
// Modo A: el evento sintético completo.
const CAMPOS_EVENTO = ['evidenciaId', 'registroOpacoId', 'prevEvidenciaId', 'version', 'operacion', 'schemaVersion', 'contenido'];

const TAMANO_MAX_EVIDENCIA = 1024;
// Tamaño máximo (bytes UTF-8) del evento del modo A. Configurable al desplegar (debe ser igual en todos los peers).
const TAMANO_MAX_EVENTO = Number.parseInt(process.env.TAMANO_MAX_EVENTO || '4096', 10);

// Claves que nunca pueden aparecer dentro del contenido sintético (defensa ante datos identificables).
const CLAVES_PROHIBIDAS = /^(nombres?|apellidos?|dni|documento|estudiante|estudianteid|alumno|codigo(estudiante|institucional)?|correo|email|telefono|direccion)$/i;

function falla(codigo, mensaje) {
  // El prefijo `CODIGO:` permite al cliente (F5) distinguir el tipo de error.
  throw new Error(`${codigo}: ${mensaje}`);
}

function leerJson(texto, max) {
  if (typeof texto !== 'string') falla('ENTRADA_INVALIDA', 'se esperaba un JSON como texto');
  if (Buffer.byteLength(texto, 'utf8') > max) falla('TAMANO_EXCEDIDO', `el JSON supera ${max} bytes`);
  let v;
  try {
    v = JSON.parse(texto);
  } catch (e) {
    falla('ENTRADA_INVALIDA', 'JSON mal formado');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) falla('ENTRADA_INVALIDA', 'se esperaba un objeto JSON');
  return v;
}

function exigirCampos(obj, permitidos) {
  const extra = Object.keys(obj).filter((k) => !permitidos.includes(k));
  if (extra.length) falla('CAMPO_NO_PERMITIDO', extra.sort().join(', '));
  const faltan = permitidos.filter((k) => !Object.prototype.hasOwnProperty.call(obj, k));
  if (faltan.length) falla('CAMPO_FALTANTE', faltan.join(', '));
}

function validarCadena(e) {
  if (typeof e.evidenciaId !== 'string' || !UUID.test(e.evidenciaId)) falla('ENTRADA_INVALIDA', 'evidenciaId debe ser un UUID en minúsculas');
  if (typeof e.registroOpacoId !== 'string' || !UUID.test(e.registroOpacoId)) falla('ENTRADA_INVALIDA', 'registroOpacoId debe ser un UUID en minúsculas');
  if (!Number.isInteger(e.version) || e.version < 1 || e.version > VERSION_MAX) falla('ENTRADA_INVALIDA', 'version debe ser un entero >= 1');
  if (!OPERACIONES.includes(e.operacion)) falla('ENTRADA_INVALIDA', `operacion debe ser una de ${OPERACIONES.join(', ')}`);
  if (!SCHEMA_VERSIONS.includes(e.schemaVersion)) falla('ENTRADA_INVALIDA', `schemaVersion no admitida: ${e.schemaVersion}`);
  if (e.version === 1) {
    if (e.prevEvidenciaId !== null) falla('ENCADENAMIENTO', 'la versión 1 no tiene evidencia previa (prevEvidenciaId = null)');
    if (e.operacion !== 'CREAR') falla('ENCADENAMIENTO', 'la versión 1 debe ser CREAR');
  } else {
    if (typeof e.prevEvidenciaId !== 'string' || !UUID.test(e.prevEvidenciaId)) falla('ENCADENAMIENTO', 'prevEvidenciaId es obligatorio si version > 1');
    if (e.operacion === 'CREAR') falla('ENCADENAMIENTO', 'CREAR solo es válido en la versión 1');
  }
}

function revisarContenido(v, ruta) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isSafeInteger(v)) falla('ENTRADA_INVALIDA', `${ruta}: solo enteros (decimales como texto)`);
    return;
  }
  for (const [k, hijo] of Object.entries(v)) {
    if (CLAVES_PROHIBIDAS.test(k)) falla('CAMPO_NO_PERMITIDO', `${ruta}.${k}: el contenido no puede llevar datos identificables`);
    revisarContenido(hijo, `${ruta}.${k}`);
  }
}

const relleno = (version) => String(version).padStart(10, '0');

function fechaTx(ctx) {
  const ts = ctx.stub.getTxTimestamp();
  const segundos = typeof ts.seconds === 'object' && ts.seconds !== null ? ts.seconds.toNumber() : Number(ts.seconds);
  return new Date(segundos * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

/** JSON con claves ordenadas recursivamente: compara contenidos sin depender del orden de las claves. */
function ordenado(v) {
  if (Array.isArray(v)) return `[${v.map(ordenado).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${ordenado(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Campos enviados por el cliente de un registro guardado (para comparar idempotencia). */
function camposCliente(registro, campos) {
  const salida = {};
  for (const c of campos) salida[c] = registro[c];
  return ordenado(salida);
}

class Trazabilidad extends Contract {
  constructor() {
    super('trazabilidad');
  }

  /** Modo B: ancla la evidencia (ids opacos + HMAC). Idempotente por evidenciaId. */
  async RegistrarEvidencia(ctx, json) {
    const e = leerJson(json, TAMANO_MAX_EVIDENCIA);
    exigirCampos(e, CAMPOS_EVIDENCIA);
    validarCadena(e);
    if (typeof e.hmac !== 'string' || !HMAC.test(e.hmac)) falla('ENTRADA_INVALIDA', 'hmac debe ser SHA-256 hex (64 caracteres en minúsculas)');

    return this._registrar(ctx, 'EVIDENCIA', e, CAMPOS_EVIDENCIA);
  }

  /** Modo A: guarda el evento SINTÉTICO completo. Idempotente por evidenciaId. */
  async RegistrarEventoCompleto(ctx, json) {
    const e = leerJson(json, TAMANO_MAX_EVENTO);
    exigirCampos(e, CAMPOS_EVENTO);
    validarCadena(e);
    if (e.contenido === null || typeof e.contenido !== 'object' || Array.isArray(e.contenido)) {
      falla('ENTRADA_INVALIDA', 'contenido debe ser un objeto');
    }
    revisarContenido(e.contenido, 'contenido');

    return this._registrar(ctx, 'EVENTO', e, CAMPOS_EVENTO);
  }

  async ObtenerEvidencia(ctx, evidenciaId) {
    if (!UUID.test(evidenciaId || '')) falla('ENTRADA_INVALIDA', 'evidenciaId debe ser un UUID');
    const registro = await this._porId(ctx, evidenciaId);
    if (!registro) falla('NO_ENCONTRADO', `no existe la evidencia ${evidenciaId}`);
    return JSON.stringify(await this._conRevocacion(ctx, registro));
  }

  /** Todas las versiones del registro, en orden. [] si no hay ninguna. */
  async HistorialRegistro(ctx, registroOpacoId) {
    if (!UUID.test(registroOpacoId || '')) falla('ENTRADA_INVALIDA', 'registroOpacoId debe ser un UUID');
    const iterador = await ctx.stub.getStateByPartialCompositeKey(CLAVE_VERSION, [registroOpacoId]);
    const salida = [];
    try {
      for (let r = await iterador.next(); !r.done; r = await iterador.next()) {
        salida.push(await this._conRevocacion(ctx, JSON.parse(Buffer.from(r.value.value).toString('utf8'))));
      }
    } finally {
      await iterador.close();
    }
    return JSON.stringify(salida);
  }

  /** Marca una evidencia como revocada sin borrar nada. motivoCodigo es un código cerrado. */
  async Revocar(ctx, evidenciaId, motivoCodigo) {
    if (!UUID.test(evidenciaId || '')) falla('ENTRADA_INVALIDA', 'evidenciaId debe ser un UUID');
    if (!MOTIVOS_REVOCACION.includes(motivoCodigo)) {
      falla('ENTRADA_INVALIDA', `motivoCodigo debe ser uno de ${MOTIVOS_REVOCACION.join(', ')}`);
    }
    const registro = await this._porId(ctx, evidenciaId);
    if (!registro) falla('NO_ENCONTRADO', `no existe la evidencia ${evidenciaId}`);

    const clave = ctx.stub.createCompositeKey(CLAVE_REVOCACION, [evidenciaId]);
    const previa = await ctx.stub.getState(clave);
    if (previa && previa.length) {
      const r = JSON.parse(Buffer.from(previa).toString('utf8'));
      if (r.motivoCodigo !== motivoCodigo) falla('CONFLICTO', `la evidencia ya fue revocada con ${r.motivoCodigo}`);
      return JSON.stringify(r); // idempotente
    }
    const revocacion = {
      tipo: 'REVOCACION',
      evidenciaId,
      registroOpacoId: registro.registroOpacoId,
      motivoCodigo,
      fechaTx: fechaTx(ctx),
      txId: ctx.stub.getTxID(),
    };
    await ctx.stub.putState(clave, Buffer.from(JSON.stringify(revocacion)));
    return JSON.stringify(revocacion);
  }

  // ----- internos -----

  async _registrar(ctx, tipo, e, campos) {
    // Idempotencia: mismo id y mismo contenido -> se devuelve lo existente sin escribir.
    const existente = await this._porId(ctx, e.evidenciaId);
    if (existente) {
      const iguales = existente.tipo === tipo && camposCliente(existente, campos) === camposCliente(e, campos);
      if (!iguales) falla('CONFLICTO', `la evidencia ${e.evidenciaId} ya existe con otro contenido`);
      return JSON.stringify(existente);
    }

    const claveVersion = ctx.stub.createCompositeKey(CLAVE_VERSION, [e.registroOpacoId, relleno(e.version)]);
    const ocupada = await ctx.stub.getState(claveVersion);
    if (ocupada && ocupada.length) falla('ENCADENAMIENTO', `el registro ya tiene la versión ${e.version}`);

    if (e.version > 1) {
      const prev = await this._porId(ctx, e.prevEvidenciaId);
      if (!prev || prev.registroOpacoId !== e.registroOpacoId || prev.version !== e.version - 1) {
        falla('ENCADENAMIENTO', `prevEvidenciaId debe ser la versión ${e.version - 1} del mismo registro`);
      }
    }

    // Orden de claves fijo: el JSON escrito es idéntico en todos los peers.
    const registro = { tipo };
    for (const c of campos) registro[c] = e[c];
    registro.fechaTx = fechaTx(ctx);
    registro.txId = ctx.stub.getTxID();

    await ctx.stub.putState(claveVersion, Buffer.from(JSON.stringify(registro)));
    await ctx.stub.putState(
      ctx.stub.createCompositeKey(CLAVE_ID, [e.evidenciaId]),
      Buffer.from(JSON.stringify({ registroOpacoId: e.registroOpacoId, version: e.version })),
    );
    return JSON.stringify(registro);
  }

  async _porId(ctx, evidenciaId) {
    const ptr = await ctx.stub.getState(ctx.stub.createCompositeKey(CLAVE_ID, [evidenciaId]));
    if (!ptr || !ptr.length) return null;
    const { registroOpacoId, version } = JSON.parse(Buffer.from(ptr).toString('utf8'));
    const datos = await ctx.stub.getState(ctx.stub.createCompositeKey(CLAVE_VERSION, [registroOpacoId, relleno(version)]));
    return datos && datos.length ? JSON.parse(Buffer.from(datos).toString('utf8')) : null;
  }

  async _conRevocacion(ctx, registro) {
    const r = await ctx.stub.getState(ctx.stub.createCompositeKey(CLAVE_REVOCACION, [registro.evidenciaId]));
    return { ...registro, revocacion: r && r.length ? JSON.parse(Buffer.from(r).toString('utf8')) : null };
  }
}

module.exports = { Trazabilidad, MOTIVOS_REVOCACION, OPERACIONES, CAMPOS_EVIDENCIA, CAMPOS_EVENTO };
