/**
 * Línea "También: …" de la ficha del evento (ADR 0125): nombres de las categorías secundarias, sin repetir la
 * principal y en el orden del servidor. null si no hay ninguna. NO AI REQUIRED.
 */
export function secondaryLine(
  e: { categoryCode: string; secondaryCategories?: string[] },
  nameOf: (code: string) => string,
  label: string,
): string | null {
  const names = [...new Set((e.secondaryCategories ?? []).filter((c) => c !== e.categoryCode).map(nameOf))];
  return names.length ? `${label} ${names.join(" · ")}` : null;
}
