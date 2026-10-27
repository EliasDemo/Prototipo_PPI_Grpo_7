'use strict';

// Stub mínimo de ctx.stub (fabric-shim 2.5) para probar el contrato sin red.
// Reproduce el formato real de las claves compuestas y el iterador por clave parcial.

const SEP = '\u0000';

class Long {
  constructor(n) {
    this.n = n;
  }
  toNumber() {
    return this.n;
  }
}

class StubFalso {
  constructor() {
    this.estado = new Map(); // clave -> Buffer
    this.escrituras = []; // [clave] por transacción, para comprobar que no se borra nada
    this.borrados = 0;
    this.tx = { id: 'tx-0', segundos: 1800000000, nanos: 0 };
  }

  /** Simula una transacción nueva con un id y un timestamp dados. */
  nuevaTx(id, segundos, nanos = 0) {
    this.tx = { id, segundos, nanos };
    this.escrituras = [];
  }

  createCompositeKey(tipo, atributos) {
    return `${SEP}${tipo}${SEP}${atributos.map((a) => `${a}${SEP}`).join('')}`;
  }

  async getState(clave) {
    return this.estado.get(clave) ?? Buffer.alloc(0);
  }

  async putState(clave, valor) {
    this.estado.set(clave, Buffer.from(valor));
    this.escrituras.push(clave);
  }

  async deleteState(clave) {
    this.borrados++;
    this.estado.delete(clave);
  }

  async getStateByPartialCompositeKey(tipo, atributos) {
    const prefijo = this.createCompositeKey(tipo, atributos);
    const claves = [...this.estado.keys()].filter((k) => k.startsWith(prefijo)).sort();
    let i = 0;
    const estado = this.estado;
    return {
      async next() {
        if (i >= claves.length) return { done: true };
        const key = claves[i++];
        return { done: false, value: { key, value: estado.get(key) } };
      },
      async close() {},
    };
  }

  getTxID() {
    return this.tx.id;
  }

  getTxTimestamp() {
    return { seconds: new Long(this.tx.segundos), nanos: this.tx.nanos };
  }
}

const contexto = () => ({ stub: new StubFalso() });

module.exports = { StubFalso, contexto };
