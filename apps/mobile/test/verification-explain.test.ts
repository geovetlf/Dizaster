import { describe, expect, it } from "vitest";
import { setLang, t, type MessageKey } from "../src/lib/i18n";
import { explainLines } from "../src/lib/verification/explain";

// Explicación legible completa (Blueprint §10.4, ADR 0086). NO AI REQUIRED.
const es = (k: MessageKey) => { setLang("es"); return t(k); };
const hhmm = (iso: string) => iso.slice(11, 16);

describe("explicación completa", () => {
  it("arma la frase del Blueprint con horas y fuentes", () => {
    const lines = explainLines({
      explanation: [
        { code: "CITIZEN_CORROBORATION", params: { independentWeight: 5, threshold: 3, from: "2026-09-29T14:05:00Z", to: "2026-09-29T14:20:00Z" } },
        { code: "EXTERNAL_SOURCES", params: { count: 1, sources: "NASA FIRMS", at: "2026-09-29T14:30:00Z" } },
        { code: "NOT_OFFICIAL_YET", params: {} },
      ],
    }, es as never, hhmm);
    expect(lines).toEqual([
      "Confirmaciones independientes en el lugar entre 14:05 y 14:20: 5 de 3 necesarias.",
      "Corroborado externamente: NASA FIRMS, 14:30.",
      "No confirmado oficialmente todavía.",
    ]);
  });

  it("explicaciones antiguas sin detalle usan la línea corta; estados de moderación", () => {
    const lines = explainLines({
      explanation: [
        { code: "OFFICIAL_CONFIRMATION", params: { count: 1 } },
        { code: "MARKED_FALSE", params: {} },
        { code: "DISPUTED", params: {} },
      ],
    }, es as never);
    expect(lines).toEqual([
      "Confirmado por una fuente oficial.",
      "Marcado como falso por moderación tras revisar la evidencia.",
      "Hay versiones contradictorias de personas en el lugar: tómalo con precaución.",
    ]);
  });

  it("negación de una fuente externa (ADR 0115)", () => {
    const lines = explainLines({
      explanation: [{ code: "EXTERNAL_DENIAL", params: { count: 1, sources: "USGS", at: "2026-09-29T15:00:00Z" } }],
    }, es as never, hhmm);
    expect(lines).toEqual(["Una fuente externa dice que no ocurrió: USGS, 15:00."]);
  });

  it("las cuatro lenguas tienen todas las líneas nuevas", () => {
    const keys = ["why_CITIZEN_WINDOW", "why_EXTERNAL_NAMED", "why_OFFICIAL_NAMED", "why_OFFICIAL_DENIAL_NAMED", "why_EXTERNAL_DENIAL", "why_EXTERNAL_DENIAL_NAMED", "why_MARKED_FALSE", "why_DISPUTED", "why_NOT_OFFICIAL_YET"];
    for (const lang of ["es", "en", "pt", "fr"] as const) { setLang(lang); for (const k of keys) expect(t(k as MessageKey), `${lang}.${k}`).toBeTruthy(); }
    setLang("es");
  });
});
