import { z } from "zod";
import { CountryCode, LocalizedText } from "./common.js";

export const EmergencyService = z.enum([
  "GENERAL",
  "POLICE",
  "FIRE",
  "AMBULANCE",
  "CIVIL_DEFENSE",
  "COAST_GUARD",
  "MOUNTAIN_RESCUE",
  "POISON",
  "GENDER_VIOLENCE",
  "CHILD",
  "OTHER",
]);
export type EmergencyService = z.infer<typeof EmergencyService>;

export const EmergencyNumber = z.object({
  country: CountryCode,
  subdivision: z.string().nullable().default(null),
  service: EmergencyService,
  number: z.string().regex(/^[0-9*#+]{2,15}$/),
  label: LocalizedText,
  /** Fuente pública de la que se tomó el número. */
  source: z.string(),
  /**
   * Un número solo se muestra como verificado cuando una persona lo contrastó con la fuente oficial.
   * Mostrar un número incorrecto es peligroso: es una puerta de lanzamiento por país.
   */
  verification: z.enum(["VERIFIED", "NEEDS_VERIFICATION"]),
  verifiedAt: z.string().nullable().default(null),
});
export type EmergencyNumber = z.infer<typeof EmergencyNumber>;

export const EmergencyDataset = z.object({
  version: z.string(),
  numbers: z.array(EmergencyNumber),
});
export type EmergencyDataset = z.infer<typeof EmergencyDataset>;

/**
 * Respuesta de `/v1/reference/emergency-numbers?since=<versión>` (ADR 0039). Si la app ya tiene la versión
 * vigente, `unchanged` y sin números: la consulta diaria cuesta unos bytes.
 */
export const EmergencyNumbersResponse = z.object({
  version: z.string(),
  unchanged: z.boolean(),
  numbers: z.array(EmergencyNumber),
});
export type EmergencyNumbersResponse = z.infer<typeof EmergencyNumbersResponse>;

/** Compara versiones tipo `emergency-2026.09.10` por tramos numéricos (10 > 9). */
export function compareDatasetVersions(a: string, b: string): number {
  const parts = (v: string) => (v.match(/\d+/g) ?? []).map(Number);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
