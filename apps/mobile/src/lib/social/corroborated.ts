import type { ProfileView } from "@dizaster/contracts";

/**
 * Línea pública de reputación (D3, ADR 0321): «12 reportes corroborados · 3 con confirmación oficial». La parte
 * oficial va aparte: una corroboración de la comunidad no es una confirmación oficial. Nada si la persona lo ocultó o
 * todavía no tiene ninguno.
 */
export function corroboratedLine(
  c: ProfileView["corroboratedReports"] | undefined,
  tf: (key: "corroboratedReports" | "corroboratedOfficial", params: { n: number }) => string,
): string | null {
  if (!c || c.total === 0) return null;
  const main = tf("corroboratedReports", { n: c.total });
  return c.official > 0 ? `${main} · ${tf("corroboratedOfficial", { n: c.official })}` : main;
}
