import { effectiveCategory, type CategoryCatalog, type CategoryConfig } from "@dizaster/contracts";
import { File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { describeCategory, newestCatalog, pickableCategories, reportableCategories } from "./category-catalog";
import { API_URL } from "./config";
import { preferredCountry } from "./geo/preferred-country";
import { lang } from "./i18n";

// Catálogo empaquetado: las categorías funcionan sin conexión desde la primera apertura.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundled = require("../reference-data/categories.json") as CategoryCatalog;

/** Catálogo descargado con su etag, para preguntar al servidor sin volver a descargarlo (ADR 0084, 0152). */
const file = () => new File(Paths.document, "categories.json");

function load(): { catalog: CategoryCatalog; etag: string | null } {
  try {
    const f = file();
    if (!f.exists) return { catalog: bundled, etag: null };
    const saved = JSON.parse(f.textSync()) as { catalog?: unknown; etag?: unknown };
    const catalog = newestCatalog(bundled, saved.catalog);
    return { catalog, etag: catalog !== bundled && typeof saved.etag === "string" ? saved.etag : null };
  } catch {
    return { catalog: bundled, etag: null };
  }
}

let state: { catalog: CategoryCatalog; etag: string | null } | null = null;
const listeners = new Set<() => void>();
const current = () => (state ??= load());

export const categoryCatalog = (): CategoryCatalog => current().catalog;
/** País cuyos ajustes se aplican al mostrar y elegir: el preferido del perfil (el reporte usa el de su ubicación). */
const country = () => preferredCountry();

export const findCategory = (code: string, inCountry: string | null = country()): CategoryConfig | undefined =>
  describeCategory(categoryCatalog(), code, inCountry);
/** Estricta: la categoría tal como rige en ese país, o `undefined` si allí está desactivada (para reportar). */
export const categoryIn = (code: string, inCountry: string | null): CategoryConfig | undefined =>
  effectiveCategory(categoryCatalog(), code, inCountry);
export const categoryLabel = (code: string): string => {
  const c = findCategory(code);
  return c?.names[lang] ?? c?.names["es"] ?? code;
};
export const pickerCategories = (inCountry: string | null = country()): CategoryConfig[] => pickableCategories(categoryCatalog(), inCountry);
export const reportCategories = (inCountry: string | null = country()): CategoryConfig[] => reportableCategories(categoryCatalog(), inCountry);

/** Versión vigente: los componentes que listan categorías se vuelven a dibujar si llega un catálogo nuevo. */
export function useCategoryCatalogVersion(): string {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => categoryCatalog().version);
}

/** Pregunta al servidor con el etag guardado; si hay versión nueva la guarda y avisa. Cualquier fallo deja lo local. */
export async function refreshCategoryCatalog(): Promise<boolean> {
  const now = current();
  try {
    const res = await fetch(`${API_URL}/v1/reference/categories`, { headers: now.etag ? { "if-none-match": now.etag } : {} });
    if (res.status === 304 || !res.ok) return false;
    const next = newestCatalog(now.catalog, await res.json());
    if (next === now.catalog) return false;
    state = { catalog: next, etag: res.headers.get("etag") };
    const f = file();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(state));
    for (const l of listeners) l();
    return true;
  } catch {
    return false;
  }
}
