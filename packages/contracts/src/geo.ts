import { z } from "zod";

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

/** Caja [oeste, sur, este, norte] en grados. */
export const BBox = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(([w, s, e, n]) => s <= n && w >= -180 && e <= 180 && s >= -90 && n <= 90, "bbox inválido");
export type BBox = z.infer<typeof BBox>;

/**
 * Sensibilidad de una categoría: gobierna cuánto se generaliza la ubicación pública.
 * NORMAL ≈ 100 m, SENSITIVE ≈ 1 km², HIGHLY_SENSITIVE ≈ 5 km².
 */
export const Sensitivity = z.enum(["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

/** Área administrativa pública (región, ciudad o distrito) de un índice geográfico abierto. */
export const AdminAreaRef = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
});
export type AdminAreaRef = z.infer<typeof AdminAreaRef>;

export const PlaceGranularity = z.enum(["COUNTRY", "REGION", "CITY", "DISTRICT"]);
export type PlaceGranularity = z.infer<typeof PlaceGranularity>;

/**
 * Ubicación contextual de un EVENT: país → región → ciudad → distrito.
 * Se deriva SOLO del punto público ya generalizado, nunca de la ubicación privada del reportero,
 * y pierde detalle según la sensibilidad (HIGHLY_SENSITIVE no muestra distrito).
 */
export const ContextualLocation = z.object({
  country: z.object({ code: z.string().regex(/^[A-Z]{2}$/), name: z.string() }).nullable(),
  region: AdminAreaRef.nullable(),
  city: z.object({ id: z.string().nullable(), name: z.string() }).nullable(),
  district: AdminAreaRef.nullable(),
  /** Texto listo para mostrar: "Miraflores, Lima". */
  label: z.string(),
  granularity: PlaceGranularity,
  timezone: z.string().nullable(),
});
export type ContextualLocation = z.infer<typeof ContextualLocation>;

export const AreaSearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  /** Ubicación aproximada del lector (2 decimales) para ordenar homónimos por cercanía. Opcional. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export interface AreaSearchResult {
  id: string;
  level: 1 | 2 | 3;
  /** Nombre del nivel en el país: "Departamento", "Provincia", "Distrito"… */
  kind: string;
  countryCode: string;
  name: string;
  /** Nombre con su jerarquía: "Miraflores, Lima, Lima". */
  label: string;
  center: GeoPoint;
  bbox: BBox;
}
