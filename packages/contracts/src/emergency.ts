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
  /** Solo un número disponible siempre (24/7) se marca directo desde un reporte (ADR 0062). */
  availability: z.enum(["ALWAYS", "LIMITED"]).default("ALWAYS"),
});
export type EmergencyNumber = z.infer<typeof EmergencyNumber>;

/**
 * Qué servicio atiende una categoría (ADR 0062). `category` es un prefijo del código ("fire" cubre "fire.structure");
 * `country` "*" vale para todos. Los servicios van en orden de preferencia: se marca el primero que tenga número.
 */
export const EmergencyRoute = z.object({
  country: z.union([CountryCode, z.literal("*")]),
  subdivision: z.string().nullable().default(null),
  category: z.string().min(1),
  services: z.array(EmergencyService).min(1),
});
export type EmergencyRoute = z.infer<typeof EmergencyRoute>;

export const EmergencyDataset = z.object({
  version: z.string(),
  numbers: z.array(EmergencyNumber),
  routes: z.array(EmergencyRoute).default([]),
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
  routes: z.array(EmergencyRoute).default([]),
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

const matchesCategory = (prefix: string, code: string) => code === prefix || code.startsWith(`${prefix}.`);

/**
 * Número al que llama directamente el botón "Llamar" de un reporte (ADR 0062, sin IA). Regla más específica primero
 * (país y subdivisión concretos antes que "*", categoría más larga antes que la general); dentro de una regla, el primer
 * servicio con número disponible 24/7, prefiriendo el de la subdivisión al nacional. null → se muestra la lista.
 */
export function directEmergencyNumber(
  dataset: Pick<EmergencyDataset, "numbers" | "routes">,
  where: { category: string; country: string | null; subdivision?: string | null },
): EmergencyNumber | null {
  const { category, country } = where;
  const subdivision = where.subdivision ?? null;
  if (!country) return null;
  const score = (r: EmergencyRoute) => (r.country === country ? 4 : 0) + (r.subdivision !== null ? 2 : 0) + r.category.length / 1000;
  const routes = dataset.routes
    .filter((r) => (r.country === "*" || r.country === country) && (r.subdivision === null || r.subdivision === subdivision) && matchesCategory(r.category, category))
    .sort((a, b) => score(b) - score(a));
  const available = dataset.numbers.filter((n) => n.country === country && n.availability === "ALWAYS" && (n.subdivision === null || n.subdivision === subdivision));
  for (const route of routes) {
    for (const service of route.services) {
      const hits = available.filter((n) => n.service === service);
      const hit = hits.find((n) => n.subdivision !== null) ?? hits[0];
      if (hit) return hit;
    }
  }
  return null;
}
