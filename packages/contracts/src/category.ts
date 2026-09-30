import { z } from "zod";
import { AdminReason } from "./admin-config.js";
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
  /**
   * Minutos que espera un EVENT creado por reporte ciudadano, y el post del reporte, antes de ser públicos (§8.5,
   * ADR 0099). Solo para HIGHLY_SENSITIVE; 0 = sin retraso. Una fuente oficial o externa lo publica en el acto.
   */
  publishDelayMinutes: z.number().int().min(0).max(1440).default(0),
});
/** Retraso de publicación de una categoría HIGHLY_SENSITIVE, editable por administración (ADR 0109). */
export const SetPublishDelayRequest = z.object({ minutes: z.number().int().min(0).max(1440), reason: AdminReason });
export interface PublishDelayView { category: string; minutes: number; catalogMinutes: number; overridden: boolean; updatedAt: string | null }

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
    publishDelayMinutes: true,
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

/**
 * Configuración efectiva de una categoría para un país (ADR 0152): el override regional pisa los campos que define y
 * los nombres; `undefined` si no existe o está desactivada en ese país. Misma regla en servidor y app. NO AI REQUIRED.
 */
export function effectiveCategory(catalog: Pick<CategoryCatalog, "categories" | "regionOverrides">, code: string, country?: string | null): CategoryConfig | undefined {
  const base = catalog.categories.find((c) => c.code === code);
  if (!base || !country) return base;
  const o = catalog.regionOverrides.find((r) => r.category === code && r.country === country);
  if (!o) return base;
  if (!o.enabled) return undefined;
  return { ...base, ...o.overrides, names: { ...base.names, ...(o.names ?? {}) } };
}

/** Categorías disponibles en un país, con sus ajustes aplicados (las desactivadas no aparecen). */
export function categoriesFor(catalog: Pick<CategoryCatalog, "categories" | "regionOverrides">, country?: string | null): CategoryConfig[] {
  return catalog.categories.flatMap((c) => effectiveCategory(catalog, c.code, country) ?? []);
}
