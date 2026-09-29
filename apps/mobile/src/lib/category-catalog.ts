import { CategoryCatalog, categoriesFor, compareDatasetVersions, effectiveCategory, type CategoryConfig } from "@dizaster/contracts";

/**
 * Lógica pura del catálogo de categorías en el teléfono (ADR 0152). NO AI REQUIRED.
 * El empaquetado siempre sirve sin red; uno descargado solo lo reemplaza si es válido y de versión más nueva.
 */
export function newestCatalog(bundled: CategoryCatalog, downloaded: unknown): CategoryCatalog {
  const parsed = CategoryCatalog.safeParse(downloaded);
  if (!parsed.success) return bundled;
  return compareDatasetVersions(parsed.data.version, bundled.version) > 0 ? parsed.data : bundled;
}

/** Para mostrar un código ya existente: la versión del país si está disponible, si no la base (nunca se pierde el nombre). */
export function describeCategory(catalog: CategoryCatalog, code: string, country: string | null): CategoryConfig | undefined {
  return effectiveCategory(catalog, code, country) ?? effectiveCategory(catalog, code, null);
}

/** Para elegir: solo lo disponible en el país, con sus nombres y ajustes. */
export function pickableCategories(catalog: CategoryCatalog, country: string | null): CategoryConfig[] {
  return categoriesFor(catalog, country);
}

/** Lo que se reporta: hojas ciudadanas del país (una hija desactivada no deja reportable a su padre). */
export function reportableCategories(catalog: CategoryCatalog, country: string | null): CategoryConfig[] {
  const list = pickableCategories(catalog, country);
  return list.filter((c) => c.citizenReportable && !catalog.categories.some((x) => x.parent === c.code));
}
