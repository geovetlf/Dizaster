import type { Gate } from "./plan.js";
import type { Impact } from "./inspect.js";
import type { Outcome } from "./policy.js";

/**
 * Informe del Delivery Plane en Markdown para el comentario del PR (Blueprint §20.5). Solo datos del análisis
 * determinístico: nada de secretos ni contenido de archivos.
 */
export function markdownReport(im: Impact, gates: Gate[], outcomes: { staging: Outcome; production: Outcome }): string {
  const lines = [
    "## Dizaster Delivery Plane",
    "",
    `**Riesgo:** ${im.risk} · **staging:** ${outcomes.staging} · **producción:** ${outcomes.production}`,
    "",
  ];
  if (im.reasons.length) lines.push("**Motivos**", "", ...im.reasons.map((r) => `- ${r}`), "");
  if (im.migrationFindings.length) lines.push("**Migraciones**", "", ...im.migrationFindings.map((f) => `- ${f.class}: \`${f.file}\` ${f.message}`), "");
  lines.push(
    `**Paquetes afectados:** ${im.affectedPackages.map((p) => `\`${p}\``).join(", ") || "—"}`,
    `**Regresión completa:** ${im.fullRegression ? "sí" : "no"}`,
    "",
    "| Etapa | Gate | Por qué |",
    "| --- | --- | --- |",
    ...gates.map((g) => `| ${g.stage} | \`${g.command}\` | ${g.why} |`),
  );
  return `${lines.join("\n")}\n`;
}
