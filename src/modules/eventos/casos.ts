import "server-only";
import { randomUUID } from "node:crypto";
import type { Autenticado } from "@/modules/autenticacion/requerir";
import { env } from "@/server/config/env";
import { ErrorApi } from "@/server/http/respuestas";
import { estrategia } from "@/server/storage-strategies";
import { cambiosAsistencia, cambiosNota, cuerpoCrear, cuerpoRectificar, ESTADOS_ASISTENCIA, uuid } from "./esquemas";
import { cadenaDeVersiones, eventoEnVersion, leerRegistro, payloadDesdeOrigen } from "./repositorio";
import type { Confirmacion, EventoConEvidencia, PayloadEvento, Verificacion } from "./tipos";

// Casos de uso del modelo de eventos (F3.5). La idempotencia se aplica en la capa HTTP.

/** El actor es un rol, nunca un nombre: "operador" | "benchmark". */
const actorDe = (a: Autenticado) => a.tipo;

const ahora = () => new Date().toISOString();

/** Crea una copia de ensayo de una nota o asistencia del origen: registro nuevo + evento CREAR v1. */
export async function crearCopia(entrada: unknown, auth: Autenticado, idempotencyKey: string): Promise<Confirmacion> {
  const cuerpo = cuerpoCrear.parse(entrada);
  const payload = await payloadDesdeOrigen(cuerpo);
  if (!payload) throw new ErrorApi("NO_ENCONTRADO", `No existe ${cuerpo.origenId} en el origen`);

  const registroId = randomUUID();
  const est = estrategia();
  return est.registrar(
    {
      idempotencyKey,
      registro: {
        registroId,
        tipo: cuerpo.tipo,
        // NullLedger tiene la semántica de B. Las estrategias reales se fijan por EXPERIMENT_STRATEGY (F5).
        estrategia: est.nombre === "NULL" ? "B" : env().EXPERIMENT_STRATEGY,
        origenTabla: cuerpo.tipo === "NOTA" ? "calificaciones" : "asistencias",
        origenId: cuerpo.origenId,
      },
      evento: {
        eventoId: randomUUID(), registroId, version: 1, operacion: "CREAR", prevEventoId: null,
        actor: actorDe(auth), fechaExperimental: ahora(), payload,
      },
    },
    0,
  );
}

/** Rectifica la versión `versionEsperada`: nuevo evento enlazado con el anterior. */
export async function rectificar(registroId: string, entrada: unknown, auth: Autenticado, idempotencyKey: string): Promise<Confirmacion> {
  if (!uuid.safeParse(registroId).success) throw new ErrorApi("NO_ENCONTRADO", "Registro no encontrado");
  const cuerpo = cuerpoRectificar.parse(entrada);

  const registro = await leerRegistro(registroId);
  if (!registro) throw new ErrorApi("NO_ENCONTRADO", "Registro no encontrado");
  if (registro.estado_vigencia !== "VIGENTE" || registro.estado_detalle !== "PRESENTE") {
    throw new ErrorApi("REGISTRO_NO_VIGENTE", "El registro está revocado o su detalle fue retirado");
  }
  // La base de la rectificación es exactamente la versión que el cliente vio.
  const base = cuerpo.versionEsperada <= registro.version_actual ? await eventoEnVersion(registroId, cuerpo.versionEsperada) : null;
  if (!base || cuerpo.versionEsperada !== registro.version_actual) {
    throw new ErrorApi("VERSION_DESACTUALIZADA", "La versión esperada no es la vigente", {
      versionEsperada: cuerpo.versionEsperada,
      versionActual: registro.version_actual,
    });
  }
  if (!base.payload) throw new ErrorApi("REGISTRO_NO_VIGENTE", "El detalle de la versión vigente fue retirado");

  const payload = aplicarCambios(base.payload, cuerpo.cambios, cuerpo.motivo);

  // El bloqueo FOR UPDATE y la comprobación definitiva de versión ocurren dentro de registrar().
  return estrategia().registrar(
    {
      idempotencyKey,
      evento: {
        eventoId: randomUUID(), registroId, version: cuerpo.versionEsperada + 1, operacion: "RECTIFICAR",
        prevEventoId: base.evento_id, actor: actorDe(auth), fechaExperimental: ahora(), payload,
      },
    },
    cuerpo.versionEsperada,
  );
}

function aplicarCambios(base: PayloadEvento, cambios: Record<string, unknown>, motivo: string): PayloadEvento {
  let nuevo: PayloadEvento;
  if (base.tipo === "NOTA") {
    const c = cambiosNota.parse(cambios);
    nuevo = { ...base, ...c, motivo };
  } else {
    const c = cambiosAsistencia.parse(cambios);
    nuevo = { ...base, estadoCodigo: c.estadoCodigo, estado: ESTADOS_ASISTENCIA[c.estadoCodigo], motivo };
  }
  const sinMotivo = (p: PayloadEvento) => JSON.stringify({ ...p, motivo: null });
  if (sinMotivo(nuevo) === sinMotivo(base)) throw new ErrorApi("VALIDACION", "Los cambios no modifican el contenido");
  return nuevo;
}

export async function obtenerEvento(eventoId: string): Promise<EventoConEvidencia> {
  const r = uuid.safeParse(eventoId).success ? await estrategia().obtener(eventoId) : null;
  if (!r) throw new ErrorApi("NO_ENCONTRADO", "Evento no encontrado");
  return r;
}

export async function verificarEvento(eventoId: string): Promise<Verificacion> {
  const r = uuid.safeParse(eventoId).success ? await estrategia().verificar(eventoId) : null;
  if (!r) throw new ErrorApi("NO_ENCONTRADO", "Evento no encontrado");
  return r;
}

/** Cadena de versiones de un registro, con comprobación de enlaces prev -> evento. */
export async function trazabilidad(registroId: string) {
  const registro = uuid.safeParse(registroId).success ? await leerRegistro(registroId) : null;
  if (!registro) throw new ErrorApi("NO_ENCONTRADO", "Registro no encontrado");
  const cadena = await cadenaDeVersiones(registroId);
  const enlacesValidos = cadena.every(
    (e, i) => e.version === i + 1 && e.prevEventoId === (i === 0 ? null : cadena[i - 1]!.eventoId),
  );
  return {
    registro: {
      registroId: registro.registro_id,
      tipo: registro.tipo,
      estrategia: registro.estrategia,
      origen: registro.origen_id ? { tabla: registro.origen_tabla, id: registro.origen_id } : null,
      estadoVigencia: registro.estado_vigencia,
      estadoDetalle: registro.estado_detalle,
      versionActual: registro.version_actual,
    },
    cadena,
    enlacesValidos: enlacesValidos && cadena.length === registro.version_actual,
  };
}
