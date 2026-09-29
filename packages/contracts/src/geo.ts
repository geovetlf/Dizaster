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
