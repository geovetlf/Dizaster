import type { CategoryCatalog } from "@dizaster/contracts";

/** Nombre de icono de MaterialCommunityIcons (@expo/vector-icons, igual en Android e iOS). */
export type IconName =
  | "earth" | "volcano" | "medical-bag" | "shield-alert" | "car" | "fire" | "bank" | "alert"
  | "account-group" | "dots-horizontal" | "alarm-light" | "help-circle";

export interface CategoryChip {
  /** null = todas las categorías. */
  code: string | null;
  label: { es: string; en: string };
  icon: IconName;
  color: string;
}

/**
 * Accesos rápidos del inicio. Son las categorías raíz del catálogo (datos, no código): si el catálogo cambia,
 * los códigos que no existan se ocultan. "Más" agrupa el resto.
 */
const CHIPS: CategoryChip[] = [
  { code: null, label: { es: "Todos", en: "All" }, icon: "earth", color: "#FFFFFF" },
  { code: "natural", label: { es: "Desastres", en: "Disasters" }, icon: "volcano", color: "#E5262E" },
  { code: "health", label: { es: "Salud", en: "Health" }, icon: "medical-bag", color: "#22C55E" },
  { code: "crime", label: { es: "Delincuencia", en: "Crime" }, icon: "shield-alert", color: "#3B82F6" },
  { code: "accident", label: { es: "Accidentes", en: "Accidents" }, icon: "car", color: "#F97316" },
  { code: "fire", label: { es: "Incendios", en: "Fires" }, icon: "fire", color: "#EF4444" },
  { code: "infra", label: { es: "Infraestructura", en: "Infrastructure" }, icon: "bank", color: "#CBD5E1" },
  { code: "prevention", label: { es: "Prevención", en: "Prevention" }, icon: "alert", color: "#FACC15" },
  { code: "help", label: { es: "Ayuda", en: "Help" }, icon: "account-group", color: "#A855F7" },
];

const MORE: CategoryChip = { code: "__more__", label: { es: "Más", en: "More" }, icon: "dots-horizontal", color: "#FFFFFF" };
const FALLBACK: Pick<CategoryChip, "icon" | "color"> = { icon: "help-circle", color: "#94A3B8" };
const EXTRA_ICONS: Record<string, Pick<CategoryChip, "icon" | "color">> = { emergency: { icon: "alarm-light", color: "#F43F5E" } };

export function homeChips(catalog: CategoryCatalog): { chips: CategoryChip[]; more: CategoryChip[] } {
  const roots = catalog.categories.filter((c) => !c.parent);
  const rootCodes = new Set(roots.map((c) => c.code));
  const chips = CHIPS.filter((c) => c.code === null || rootCodes.has(c.code));
  const shown = new Set(chips.map((c) => c.code));
  const more = roots
    .filter((c) => !shown.has(c.code))
    .map((c) => ({ code: c.code, label: { es: c.names["es"] ?? c.code, en: c.names["en"] ?? c.names["es"] ?? c.code }, ...(EXTRA_ICONS[c.code] ?? FALLBACK) }));
  return { chips: more.length ? [...chips, MORE] : chips, more };
}

export const MORE_CODE = MORE.code;

/** Categoría raíz de un código (p. ej. "fire.structure" → "fire"). */
export const rootOf = (code: string) => code.split(".")[0]!;

/** Estilo del distintivo de categoría de un post (color de su raíz). */
export function categoryStyle(code: string | null): Pick<CategoryChip, "icon" | "color"> {
  if (!code) return FALLBACK;
  const root = rootOf(code);
  return CHIPS.find((c) => c.code === root) ?? EXTRA_ICONS[root] ?? FALLBACK;
}
