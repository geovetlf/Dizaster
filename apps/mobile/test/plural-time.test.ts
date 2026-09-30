import { describe, expect, it } from "vitest";
import { pluralCategory } from "../src/lib/ui/plural";
import { eventTime, formatInZone } from "../src/lib/ui/format";
import { readFileSync } from "node:fs";

// Plurales en 4 idiomas y horas en la zona del evento (ADR 0079). NO AI REQUIRED.
describe("plurales", () => {
  it("es/en: singular solo con 1; pt/fr: también con 0", () => {
    expect([0, 1, 2].map((n) => pluralCategory(n, "es"))).toEqual(["other", "one", "other"]);
    expect([0, 1, 2].map((n) => pluralCategory(n, "en"))).toEqual(["other", "one", "other"]);
    expect([0, 1, 2].map((n) => pluralCategory(n, "pt"))).toEqual(["one", "one", "other"]);
    expect([0, 1, 2].map((n) => pluralCategory(n, "fr"))).toEqual(["one", "one", "other"]);
  });

  it("cada idioma tiene la forma singular de reportes y fuentes", () => {
    const src = ["../src/lib/i18n.ts", "../src/lib/locales/pt.ts", "../src/lib/locales/fr.ts"]
      .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    expect(src.match(/report_one:/g)).toHaveLength(4);
    expect(src.match(/source_one:/g)).toHaveLength(4);
  });
});

describe("hora en la zona del evento", () => {
  const labels = { local: "hora local", yours: "tu hora" };
  const iso = "2026-09-29T19:05:00Z";
  // Formato regional del locale de la app (ADR 0216): es-PE usa reloj de 12 h ("02:05 p. m.").
  const at = (timeZone: string) => new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

  it("misma zona: una sola hora", () => {
    expect(eventTime(iso, "es", "America/Lima", labels, "time", "America/Lima")).toBe(formatInZone(iso, "es", "America/Lima", "time"));
  });

  it("zona distinta: hora del lugar y hora de la persona", () => {
    const s = eventTime(iso, "es", "America/Lima", labels, "time", "Europe/Madrid");
    expect(s).toBe(`${at("America/Lima")} hora local · ${at("Europe/Madrid")} tu hora`);
  });

  it("zona desconocida o inválida: la del teléfono", () => {
    expect(eventTime(iso, "es", null, labels, "time", "America/Lima")).toBe(at("America/Lima"));
    expect(eventTime(iso, "es", "Mars/Olympus", labels, "time", "America/Lima")).toBe(at("America/Lima"));
  });
});
