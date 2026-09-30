import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/lib/i18n";
import { packFingerprint } from "../src/lib/map/offline-plan";

// ADR 0250: el mapa sin conexión de una zona se marca desactualizado si cambia la zona o el idioma del estilo.
describe("huella del mapa sin conexión", () => {
  const zone = { center: { lat: -12.0464, lng: -77.0428 }, radiusKm: 5 };
  const style = "https://tiles.example/style.json?lang=es";
  it("cambia con el centro, el radio y el estilo (idioma); no con ruido menor a ~10 m", () => {
    const base = packFingerprint(zone, style);
    expect(packFingerprint({ ...zone, radiusKm: 8 }, style)).not.toBe(base);
    expect(packFingerprint({ ...zone, center: { lat: -12.06, lng: -77.0428 } }, style)).not.toBe(base);
    expect(packFingerprint(zone, "https://tiles.example/style.json?lang=en")).not.toBe(base);
    expect(packFingerprint({ ...zone, center: { lat: -12.04641, lng: -77.04281 } }, style)).toBe(base);
  });
  it("la descarga guarda la huella y el estado la compara", () => {
    const s = readFileSync(new URL("../src/lib/map/offline.ts", import.meta.url), "utf8");
    expect(s).toContain("fingerprint: packFingerprint(zone, styleUrl)");
    expect(s).toContain('{ kind: "outdated", mb }');
  });
  it("textos en los cuatro idiomas", () => {
    for (const c of Object.values(CATALOGS)) expect(c.offlineMapOutdated).toContain("{mb}");
  });
});
