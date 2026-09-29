import { z } from "zod";

/** Identificadores: UUIDv7 (ordenables por tiempo y generables offline en el cliente). */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** Instante ISO-8601 con zona (siempre se persiste en UTC). */
export const Instant = z.iso.datetime({ offset: true });
export type Instant = z.infer<typeof Instant>;

/** Código ISO 3166-1 alfa-2 en mayúsculas. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/);
export type CountryCode = z.infer<typeof CountryCode>;

/** Texto localizable: { "es": "...", "en": "..." }. */
/** Idiomas de la interfaz y de los avisos (Blueprint D-19). Ampliable: un idioma nuevo es un catálogo más. */
export const SUPPORTED_LANGS = ["es", "en", "pt", "fr"] as const;
export const Lang = z.enum(SUPPORTED_LANGS);
export type Lang = z.infer<typeof Lang>;

/** Idioma soportado para una etiqueta BCP 47 ("pt-BR" → "pt"); español si no hay coincidencia. */
export function langFromLocale(locale: string | null | undefined): Lang {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGS as readonly string[]).includes(base ?? "") ? (base as Lang) : "es";
}

export const LocalizedText = z.record(z.string().min(2).max(10), z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Categorías jerárquicas: "fire.wildfire", "accident.traffic". Son datos, no código. */
export const CategoryCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/).max(64);
export type CategoryCode = z.infer<typeof CategoryCode>;

/** Edad mínima por defecto (D-13). Un país puede exigir más en `data/countries`. */
export const DEFAULT_MIN_AGE = 16;

/** Declarar la edad (ADR 0049): año y mes bastan; el servidor no los guarda. */
export const ConfirmAgeRequest = z.object({
  birthYear: z.number().int().min(1900).max(2100),
  birthMonth: z.number().int().min(1).max(12),
  /** País detectado en el teléfono: puede subir la edad mínima. */
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
});
export type ConfirmAgeRequest = z.infer<typeof ConfirmAgeRequest>;

/**
 * Edad cumplida con solo año y mes de nacimiento. Conservadora: el cumpleaños cuenta desde el mes siguiente, así nadie
 * pasa el límite antes de tiempo (quien cumple ese mes espera, como mucho, unas semanas).
 */
export function ageAt(birthYear: number, birthMonth: number, now: Date): number {
  return now.getUTCFullYear() - birthYear - (now.getUTCMonth() + 1 <= birthMonth ? 1 : 0);
}
