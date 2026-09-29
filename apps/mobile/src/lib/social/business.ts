import type { BusinessCategory, BusinessVerification, Lang } from "@dizaster/contracts";

/** Nombre de cada rubro en los idiomas de la app. */
export const BUSINESS_CATEGORY_LABEL: Record<BusinessCategory, Record<Lang, string>> = {
  food: { es: "Comida", en: "Food", pt: "Comida", fr: "Restauration" },
  grocery: { es: "Bodega o mercado", en: "Grocery", pt: "Mercearia", fr: "Épicerie" },
  pharmacy: { es: "Farmacia", en: "Pharmacy", pt: "Farmácia", fr: "Pharmacie" },
  health: { es: "Salud", en: "Health", pt: "Saúde", fr: "Santé" },
  hardware: { es: "Ferretería", en: "Hardware store", pt: "Loja de ferragens", fr: "Quincaillerie" },
  fuel: { es: "Combustible", en: "Fuel", pt: "Combustível", fr: "Carburant" },
  transport: { es: "Transporte", en: "Transport", pt: "Transporte", fr: "Transport" },
  lodging: { es: "Alojamiento", en: "Lodging", pt: "Hospedagem", fr: "Hébergement" },
  services: { es: "Servicios", en: "Services", pt: "Serviços", fr: "Services" },
  media: { es: "Medio de comunicación", en: "News media", pt: "Veículo de imprensa", fr: "Média" },
  ngo: { es: "ONG o voluntariado", en: "NGO or volunteers", pt: "ONG ou voluntariado", fr: "ONG ou bénévolat" },
  other: { es: "Otro", en: "Other", pt: "Outro", fr: "Autre" },
};

/** Icono del sello: solo los verificados lo muestran; lo institucional se distingue. */
export function verificationIcon(v: BusinessVerification | undefined): "check-decagram" | "bank" | null {
  if (v === "INSTITUTIONAL_OFFICIAL") return "bank";
  if (v === "VERIFIED") return "check-decagram";
  return null;
}

/** Enlace de llamada seguro: solo dígitos y +. */
export function telUri(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

/**
 * ¿Puede esta institución pronunciarse sobre el evento? (ADR 0095). Mismo criterio que el servidor: categoría en su
 * ámbito (o hija de una raíz listada) y país en su lista. El servidor lo vuelve a comprobar.
 * NO AI REQUIRED.
 */
export function canStateOn(
  scope: { categories: string[]; countries: string[]; active: boolean } | null,
  event: { categoryCode: string; countryCode: string | null; status: string },
): boolean {
  if (!scope?.active || (event.status !== "ACTIVE" && event.status !== "MONITORING")) return false;
  const category = scope.categories.some((c) => c === event.categoryCode || event.categoryCode.startsWith(`${c}.`));
  return category && event.countryCode !== null && (scope.countries.includes("*") || scope.countries.includes(event.countryCode));
}
