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
