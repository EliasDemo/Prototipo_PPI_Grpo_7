'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Trazabilidad } = require('../src/trazabilidad');
const { contexto } = require('./stub');

const REG = '11111111-1111-4111-8111-111111111111';
const E1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const E2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const E3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const H = (c) => c.repeat(64);

const evidencia = (extra = {}) => ({
  evidenciaId: E1, registroOpacoId: REG, prevEvidenciaId: null, version: 1, operacion: 'CREAR', hmac: H('a'), schemaVersion: 1, ...extra,
});
const eventoA = (extra = {}) => ({
  evidenciaId: E1, registroOpacoId: REG, prevEvidenciaId: null, version: 1, operacion: 'CREAR', schemaVersion: 1,
  contenido: { tipo: 'NOTA', anio: 2026, periodoId: 'PER-SINT-1', valorFuente: 'A', valorNumerico: '17.0000', motivo: null },
  ...extra,
});

let cc;
let ctx;
beforeEach(() => {
  cc = new Trazabilidad();
  ctx = contexto();
});

const json = (o) => JSON.stringify(o);
const rechaza = (p, codigo) => assert.rejects(p, (e) => e.message.startsWith(`${codigo}:`));

describe('RegistrarEvidencia (modo B)', () => {
  it('registra con la fecha y el id de la transacción, no los del cliente', async () => {
    ctx.stub.nuevaTx('tx-1', 1800000000, 123456789);
    const r = JSON.parse(await cc.RegistrarEvidencia(ctx, json(evidencia())));
    assert.equal(r.fechaTx, '2027-01-15T08:00:00.123Z');
    assert.equal(r.txId, 'tx-1');
    assert.equal(r.tipo, 'EVIDENCIA');
  });

  it('rechaza cualquier campo extra (incluida una fecha del cliente)', async () => {
    for (const extra of [{ nombre: 'x' }, { fechaExperimental: '2026-01-01' }, { payload: {} }]) {
      await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia(extra))), 'CAMPO_NO_PERMITIDO');
    }
  });

  it('exige todos los campos', async () => {
    const e = evidencia();
    delete e.prevEvidenciaId;
    await rechaza(cc.RegistrarEvidencia(ctx, json(e)), 'CAMPO_FALTANTE');
  });

  it('valida formatos', async () => {
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ hmac: 'xyz' }))), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: 'no-uuid' }))), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ schemaVersion: 2 }))), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ operacion: 'REVOCAR' }))), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEvidencia(ctx, '{no json'), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEvidencia(ctx, json([1])), 'ENTRADA_INVALIDA');
  });
});

describe('idempotencia', () => {
  it('mismo id y mismo contenido -> devuelve lo existente sin escribir', async () => {
    ctx.stub.nuevaTx('tx-1', 1800000000);
    const a = await cc.RegistrarEvidencia(ctx, json(evidencia()));
    ctx.stub.nuevaTx('tx-2', 1800000100);
    const b = await cc.RegistrarEvidencia(ctx, json(evidencia()));
    assert.equal(b, a); // misma fecha y txId: los de la primera transacción
    assert.deepEqual(ctx.stub.escrituras, []);
  });

  it('el orden de las claves del JSON no importa', async () => {
    await cc.RegistrarEventoCompleto(ctx, json(eventoA()));
    const invertido = Object.fromEntries(Object.entries(eventoA()).reverse());
    invertido.contenido = Object.fromEntries(Object.entries(eventoA().contenido).reverse());
    await cc.RegistrarEventoCompleto(ctx, json(invertido));
  });

  it('mismo id con otro contenido -> error', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ hmac: H('b') }))), 'CONFLICTO');
  });

  it('mismo id en el otro modo -> error', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    await rechaza(cc.RegistrarEventoCompleto(ctx, json(eventoA())), 'CONFLICTO');
  });
});

describe('encadenamiento de versiones', () => {
  it('v2 y v3 enlazan con la versión anterior y el historial queda en orden', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    await cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E2, prevEvidenciaId: E1, version: 2, operacion: 'RECTIFICAR', hmac: H('b') })));
    await cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E3, prevEvidenciaId: E2, version: 3, operacion: 'SUPRIMIR', hmac: H('c') })));
    const h = JSON.parse(await cc.HistorialRegistro(ctx, REG));
    assert.deepEqual(h.map((x) => [x.version, x.evidenciaId, x.prevEvidenciaId]), [[1, E1, null], [2, E2, E1], [3, E3, E2]]);
  });

  it('ordena bien más allá de la versión 9 (clave con relleno)', async () => {
    let prev = null;
    for (let v = 1; v <= 11; v++) {
      const id = `bbbbbbbb-0000-4000-8000-${String(v).padStart(12, '0')}`;
      await cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: id, prevEvidenciaId: prev, version: v, operacion: v === 1 ? 'CREAR' : 'RECTIFICAR' })));
      prev = id;
    }
    const h = JSON.parse(await cc.HistorialRegistro(ctx, REG));
    assert.deepEqual(h.map((x) => x.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('rechaza saltos, previos ajenos, bifurcaciones y reglas de la versión 1', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    // previa inexistente
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E2, prevEvidenciaId: E3, version: 2, operacion: 'RECTIFICAR' }))), 'ENCADENAMIENTO');
    // salto de versión
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E2, prevEvidenciaId: E1, version: 3, operacion: 'RECTIFICAR' }))), 'ENCADENAMIENTO');
    // previa de otro registro
    const OTRO = '22222222-2222-4222-8222-222222222222';
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E2, registroOpacoId: OTRO, prevEvidenciaId: E1, version: 2, operacion: 'RECTIFICAR' }))), 'ENCADENAMIENTO');
    // bifurcación: dos v2 distintas
    await cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E2, prevEvidenciaId: E1, version: 2, operacion: 'RECTIFICAR' })));
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E3, prevEvidenciaId: E1, version: 2, operacion: 'RECTIFICAR' }))), 'ENCADENAMIENTO');
    // v1 con previa / v1 que no es CREAR / CREAR en v>1
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E3, prevEvidenciaId: E1 }))), 'ENCADENAMIENTO');
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E3, operacion: 'RECTIFICAR' }))), 'ENCADENAMIENTO');
    await rechaza(cc.RegistrarEvidencia(ctx, json(evidencia({ evidenciaId: E3, prevEvidenciaId: E2, version: 3, operacion: 'CREAR' }))), 'ENCADENAMIENTO');
  });

  it('HistorialRegistro de un registro sin evidencias -> []', async () => {
    assert.equal(await cc.HistorialRegistro(ctx, REG), '[]');
  });
});

describe('RegistrarEventoCompleto (modo A, sintético)', () => {
  it('guarda el contenido completo', async () => {
    const r = JSON.parse(await cc.RegistrarEventoCompleto(ctx, json(eventoA())));
    assert.equal(r.tipo, 'EVENTO');
    assert.deepEqual(r.contenido, eventoA().contenido);
  });

  it('rechaza el tamaño excedido (TAMANO_MAX_EVENTO, 4096 bytes por defecto)', async () => {
    const grande = eventoA({ contenido: { relleno: 'x'.repeat(5000) } });
    await rechaza(cc.RegistrarEventoCompleto(ctx, json(grande)), 'TAMANO_EXCEDIDO');
  });

  it('rechaza claves identificables dentro del contenido, a cualquier profundidad', async () => {
    for (const contenido of [{ nombre: 'x' }, { a: { estudianteId: 'EST-1' } }, { DNI: '1' }, { lista: [{ apellidos: 'x' }] }]) {
      await rechaza(cc.RegistrarEventoCompleto(ctx, json(eventoA({ contenido }))), 'CAMPO_NO_PERMITIDO');
    }
  });

  it('rechaza números no enteros y campos extra', async () => {
    await rechaza(cc.RegistrarEventoCompleto(ctx, json(eventoA({ contenido: { valor: 17.5 } }))), 'ENTRADA_INVALIDA');
    await rechaza(cc.RegistrarEventoCompleto(ctx, json({ ...eventoA(), hmac: H('a') })), 'CAMPO_NO_PERMITIDO');
  });
});

describe('Revocar', () => {
  it('agrega la revocación sin borrar ni modificar la evidencia', async () => {
    ctx.stub.nuevaTx('tx-1', 1800000000);
    const antes = await cc.RegistrarEvidencia(ctx, json(evidencia()));
    const claves = new Map([...ctx.stub.estado].map(([k, v]) => [k, Buffer.from(v)]));

    ctx.stub.nuevaTx('tx-2', 1800000500);
    const rev = JSON.parse(await cc.Revocar(ctx, E1, 'ERROR_DE_REGISTRO'));
    assert.equal(rev.fechaTx, '2027-01-15T08:08:20.000Z');
    assert.equal(ctx.stub.borrados, 0);
    for (const [k, v] of claves) assert.ok(ctx.stub.estado.get(k).equals(v), 'una clave existente cambió');
    assert.equal(ctx.stub.escrituras.length, 1);

    const ev = JSON.parse(await cc.ObtenerEvidencia(ctx, E1));
    const { revocacion, ...resto } = ev;
    assert.deepEqual(resto, JSON.parse(antes));
    assert.equal(revocacion.motivoCodigo, 'ERROR_DE_REGISTRO');
  });

  it('motivo como código cerrado, nunca texto libre', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    await rechaza(cc.Revocar(ctx, E1, 'el alumno Juan Pérez pidió'), 'ENTRADA_INVALIDA');
    await rechaza(cc.Revocar(ctx, E1, ''), 'ENTRADA_INVALIDA');
  });

  it('idempotente con el mismo motivo; conflicto con otro', async () => {
    await cc.RegistrarEvidencia(ctx, json(evidencia()));
    const a = await cc.Revocar(ctx, E1, 'DUPLICADO');
    ctx.stub.nuevaTx('tx-9', 1800009999);
    assert.equal(await cc.Revocar(ctx, E1, 'DUPLICADO'), a);
    await rechaza(cc.Revocar(ctx, E1, 'ORDEN_ADMINISTRATIVA'), 'CONFLICTO');
  });

  it('no se puede revocar lo que no existe', async () => {
    await rechaza(cc.Revocar(ctx, E2, 'DUPLICADO'), 'NO_ENCONTRADO');
    await rechaza(cc.ObtenerEvidencia(ctx, E2), 'NO_ENCONTRADO');
  });
});

describe('determinismo', () => {
  async function secuencia(c) {
    const k = new Trazabilidad();
    c.stub.nuevaTx('tx-1', 1800000000, 1);
    await k.RegistrarEvidencia(c, json(evidencia()));
    c.stub.nuevaTx('tx-2', 1800000001, 2);
    await k.RegistrarEvidencia(c, json(evidencia({ evidenciaId: E2, prevEvidenciaId: E1, version: 2, operacion: 'RECTIFICAR', hmac: H('b') })));
    c.stub.nuevaTx('tx-3', 1800000002, 3);
    await k.Revocar(c, E2, 'DUPLICADO');
    c.stub.nuevaTx('tx-4', 1800000003, 4);
    await k.RegistrarEventoCompleto(c, json(eventoA({ evidenciaId: E3, registroOpacoId: '33333333-3333-4333-8333-333333333333' })));
    return [...c.stub.estado].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k2, v]) => [k2, v.toString('hex')]);
  }

  it('dos "peers" con las mismas transacciones producen exactamente el mismo estado', async () => {
    assert.deepEqual(await secuencia(contexto()), await secuencia(contexto()));
  });

  it('no depende del reloj ni del azar del proceso', async () => {
    const [ahora, azar] = [Date.now, Math.random];
    Date.now = () => { throw new Error('Date.now usado'); };
    Math.random = () => { throw new Error('Math.random usado'); };
    try {
      await secuencia(contexto());
    } finally {
      [Date.now, Math.random] = [ahora, azar];
    }
  });

  it('el código fuente no usa Date.now(), new Date() sin argumentos ni Math.random()', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/trazabilidad.js'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Date\.now\s*\(|Math\.random\s*\(|new Date\(\s*\)/);
  });
});
