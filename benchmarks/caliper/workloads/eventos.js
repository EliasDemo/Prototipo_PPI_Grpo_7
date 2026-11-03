'use strict';
// F9.2 Workloads notas-2026 y asistencias-2026: registros elegidos con semilla fija, en el mismo orden para toda estrategia.
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

const BASE = process.env.BENCH_BASE_URL || 'http://127.0.0.1:3100';

function mezclar(lista, semilla) {
    let s = semilla >>> 0; // mulberry32
    const azar = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = lista.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
}

class Eventos extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        const a = roundArguments;
        this.tipo = a.carga === 'ASISTENCIAS' ? 'ASISTENCIA' : 'NOTA';
        this.medir = Boolean(a.medir);
        const [ruta, campo] = this.tipo === 'NOTA'
            ? ['academico/calificaciones?anio=2026&registrada=true', 'calificacionId']
            : ['academico/asistencias?anio=2026', 'asistenciaId'];
        const ids = [];
        for (let page = 1; ids.length < a.muestra; page++) {
            const r = await fetch(`${BASE}/api/v1/${ruta}&pageSize=200&page=${page}`, { headers: { authorization: `Bearer ${process.env.BENCH_TOKEN}` } });
            if (!r.ok) throw new Error(`No se pudo leer ${ruta}: HTTP ${r.status}`);
            const { data } = await r.json();
            if (!data.length) break;
            ids.push(...data.map((f) => f[campo]));
        }
        if (!ids.length) throw new Error('No hay registros de origen para el workload');
        // Cada worker recorre su parte de la misma secuencia.
        this.ids = mezclar(ids, a.semilla).filter((_, i) => i % totalWorkers === workerIndex);
        this.i = 0;
    }
    async submitTransaction() {
        const origenId = this.ids[this.i++ % this.ids.length];
        return this.sutAdapter.sendRequests({ cuerpo: { tipo: this.tipo, origenId }, medir: this.medir });
    }
}

module.exports.createWorkloadModule = () => new Eventos();
