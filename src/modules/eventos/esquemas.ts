import { z } from "zod";
import { DECIMAL_10_4 } from "@/server/crypto/canonical";

export const uuid = z.uuid();

export const cuerpoCrear = z
  .discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("NOTA"), origenId: z.string().regex(/^NOT-[0-9A-F]{20}$/, "origenId de nota: NOT-XXXXXXXXXXXXXXXXXXXX") }).strict(),
    z.object({ tipo: z.literal("ASISTENCIA"), origenId: z.string().regex(/^ASI-[0-9A-F]{20}$/, "origenId de asistencia: ASI-XXXXXXXXXXXXXXXXXXXX") }).strict(),
  ]);

export type CuerpoCrear = z.infer<typeof cuerpoCrear>;

export const cuerpoRectificar = z
  .object({
    versionEsperada: z.number().int().min(1),
    // Texto libre: va solo al detalle (suprimible), nunca al ledger.
    motivo: z.string().trim().min(1).max(300),
    cambios: z.record(z.string(), z.unknown()),
  })
  .strict();

export const MOTIVOS_REVOCACION = ["ERROR_DE_REGISTRO", "DUPLICADO", "ORDEN_ADMINISTRATIVA", "SOLICITUD_DEL_TITULAR", "PRUEBA_DE_LABORATORIO"] as const;

// Código cerrado, igual que en el chaincode: nunca texto libre.
export const cuerpoRevocar = z.object({ motivoCodigo: z.enum(MOTIVOS_REVOCACION) }).strict();

export const cambiosNota = z
  .object({
    valorFuente: z.string().min(1).max(40).nullable().optional(),
    valorNumerico: z.string().regex(DECIMAL_10_4, "DECIMAL(10,4) como texto, p. ej. \"18.5000\"").nullable().optional(),
    registrada: z.boolean().optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, { message: "cambios vacío" });

/** Códigos de estado presentes en el origen (asistencias.estado_codigo -> estado). */
export const ESTADOS_ASISTENCIA = {
  ASIST: "ASISTENCIA",
  TI: "TARDANZA INJUSTIFICADA",
  TJ: "TARDANZA JUSTIFICADA",
  FI: "FALTA INJUSTIFICADA",
  FJ: "FALTA JUSTIFICADA",
  PRM: "PERMISO",
  MCX: "MALA CONEXIÓN",
} as const;

export const cambiosAsistencia = z
  .object({ estadoCodigo: z.enum(Object.keys(ESTADOS_ASISTENCIA) as [keyof typeof ESTADOS_ASISTENCIA]) })
  .strict();
