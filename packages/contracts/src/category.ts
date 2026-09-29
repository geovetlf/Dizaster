import { z } from "zod";
import { CategoryCode, CountryCode, LocalizedText } from "./common.js";
import { Sensitivity } from "./geo.js";

export const CategoryConfig = z.object({
  code: CategoryCode,
  parent: CategoryCode.nullable(),
  names: LocalizedText,
  icon: z.string(),
  defaultSeverity: z.number().int().min(1).max(5),
  /** Distancia máxima entre la posición del dispositivo y el pin para considerar presencia. */
  presenceRadiusM: z.number().positive(),
  /** Radio y ventana de tiempo para buscar eventos duplicados. */
  dedupRadiusM: z.number().positive(),
  dedupWindowMinutes: z.number().int().positive(),
  /** Minutos que un reporte capturado offline sigue siendo aceptado como reporte (no como testimonio tardío). */
  offlineToleranceMinutes: z.number().int().nonnegative(),
  /** Reportes independientes con presencia alta necesarios para COMMUNITY_CORROBORATED. */
  communityThreshold: z.number().int().min(2),
  sensitivity: Sensitivity,
  /** Si es false, solo fuentes externas/oficiales pueden crear eventos (p. ej. brotes sanitarios). */
  citizenReportable: z.boolean(),
  alertable: z.boolean(),
  /** Categorías con las que un evento de esta categoría puede fusionarse. */
  compatibleWith: z.array(CategoryCode).default([]),
  /** Si true, la publicación seudónima es obligatoria. */
  forcePseudonymous: z.boolean().default(false),
});
export type CategoryConfig = z.infer<typeof CategoryConfig>;

export const CategoryRegionOverride = z.object({
  category: CategoryCode,
  country: CountryCode,
  enabled: z.boolean().default(true),
  names: LocalizedText.optional(),
  overrides: CategoryConfig.pick({
    presenceRadiusM: true,
    dedupRadiusM: true,
    dedupWindowMinutes: true,
    communityThreshold: true,
    citizenReportable: true,
  })
    .partial()
    .default({}),
});
export type CategoryRegionOverride = z.infer<typeof CategoryRegionOverride>;

export const CategoryCatalog = z.object({
  version: z.string(),
  categories: z.array(CategoryConfig),
  regionOverrides: z.array(CategoryRegionOverride).default([]),
});
export type CategoryCatalog = z.infer<typeof CategoryCatalog>;
