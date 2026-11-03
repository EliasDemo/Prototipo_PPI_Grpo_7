'use strict';
// F9.1 Conector HTTP de Caliper: llama a POST /api/v1/eventos con el token de benchmark.
// Una operación solo cuenta como éxito si la respuesta indica CONFIRMADA; un 202 sigue en la bandeja.
const { randomUUID } = require('node:crypto');
const { ConnectorBase, TxStatus } = require('@hyperledger/caliper-core');

const BASE = process.env.BENCH_BASE_URL || 'http://127.0.0.1:3100';
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 60000);

class ConectorHttp extends ConnectorBase {
    constructor(workerIndex) {
        super(workerIndex, 'http');
        this.ronda = 0;
    }
    async init() {}
    async installSmartContract() {}
    async getContext(roundIndex) { this.ronda = roundIndex; return {}; }
    async releaseContext() {}

    async _sendSingleRequest(req) {
        const estado = new TxStatus(randomUUID());
        const headers = {
            authorization: `Bearer ${process.env.BENCH_TOKEN}`,
            'content-type': 'application/json',
            'idempotency-key': `bench-${randomUUID()}`,
        };
        // Solo la ronda de observación se asocia a la corrida; el calentamiento no se mide.
        if (req.medir && process.env.CORRIDA_ID) headers['x-corrida-id'] = process.env.CORRIDA_ID;
        try {
            const r = await fetch(`${BASE}/api/v1/eventos`, {
                method: 'POST', headers, body: JSON.stringify(req.cuerpo), signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const j = await r.json().catch(() => null);
            const confirmada = r.status === 201 && j && j.data && j.data.estadoOperacion === 'CONFIRMADA';
            estado.SetStatusSuccess();
            if (!confirmada) {
                estado.SetStatusFail();
                estado.SetErrMsg(0, `HTTP ${r.status} ${(j && j.error && j.error.code) || (j && j.data && j.data.estadoOperacion) || ''}`);
            }
        } catch (e) {
            estado.SetStatusFail();
            estado.SetErrMsg(0, e.name === 'TimeoutError' ? 'TIMEOUT' : e.message);
        }
        return estado;
    }
}

module.exports.ConnectorFactory = async (workerIndex) => new ConectorHttp(workerIndex);
