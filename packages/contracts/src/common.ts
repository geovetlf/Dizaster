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
export const LocalizedText = z.record(z.string().min(2).max(10), z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Categorías jerárquicas: "fire.wildfire", "accident.traffic". Son datos, no código. */
export const CategoryCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/).max(64);
export type CategoryCode = z.infer<typeof CategoryCode>;
