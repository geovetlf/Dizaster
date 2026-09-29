import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CountryLocator,
  computePresence,
  decideDedup,
  distanceMeters,
  extractKeywords,
  generalize,
  h3,
  weightedMedianPoint,
  type CountryFeature,
  type PresenceInput,
} from "../src/index.js";

const LIMA = { lat: -12.0464, lng: -77.0428 };

describe("distancia y mediana", () => {
  it("calcula distancias conocidas", () => {
    // Lima → Cusco ≈ 573 km
    expect(distanceMeters(LIMA, { lat: -13.5319, lng: -71.9675 }) / 1000).toBeCloseTo(573, -1);
    expect(distanceMeters(LIMA, LIMA)).toBe(0);
  });
  it("la mediana ponderada ignora un pin atípico", () => {
    const m = weightedMedianPoint([
      { point: { lat: -12.0, lng: -77.0 }, weight: 1 },
      { point: { lat: -12.0001, lng: -77.0001 }, weight: 1 },
      { point: { lat: -40, lng: 10 }, weight: 0.5 },
    ]);
    expect(distanceMeters(m, { lat: -12.0, lng: -77.0 })).toBeLessThan(50);
  });
});

describe("generalización de privacidad", () => {
  it("nunca devuelve la coordenada original y respeta la sensibilidad", () => {
    const normal = generalize(LIMA, "NORMAL");
    const sensitive = generalize(LIMA, "SENSITIVE");
    const high = generalize(LIMA, "HIGHLY_SENSITIVE");
    expect(normal.point).not.toEqual(LIMA);
    expect(distanceMeters(normal.point, LIMA)).toBeLessThan(100);
    expect(distanceMeters(sensitive.point, LIMA)).toBeLessThan(1000);
    expect(distanceMeters(high.point, LIMA)).toBeLessThan(3000);
    expect(high.res).toBeLessThan(sensitive.res);
  });
  it("dos puntos cercanos en una categoría sensible comparten ubicación pública", () => {
    const a = generalize({ lat: -12.04641, lng: -77.04281 }, "SENSITIVE");
    const b = generalize({ lat: -12.04651, lng: -77.04291 }, "SENSITIVE");
    expect(a.cell).toBe(b.cell);
    expect(h3(LIMA, 9)).toMatch(/^[0-9a-f]{15}$/);
  });
});

describe("presencia física", () => {
  const now = new Date("2026-09-29T10:00:30Z");
  const base = (): PresenceInput => ({
    pin: { lat: LIMA.lat + 0.0005, lng: LIMA.lng }, // ~55 m
    signals: {
      fix: { ...LIMA, accuracyM: 10, fixTime: "2026-09-29T10:00:00Z", provider: "GNSS" },
      mockLocation: false,
      attestationToken: "x",
      recentFixes: [],
      deviceClock: "2026-09-29T10:00:28Z",
    },
    category: { presenceRadiusM: 300, offlineToleranceMinutes: 60 },
    capturedAt: new Date("2026-09-29T10:00:10Z"),
    capturedOffline: false,
    receivedAt: now,
    attestation: "GENUINE",
  });

  it("presencia alta con señales buenas", () => {
    const r = computePresence(base());
    expect(r.band).toBe("HIGH");
    expect(r.reasons).toEqual([]);
  });

  it("fuera del radio nunca pasa de LOW aunque todo lo demás sea perfecto", () => {
    const i = base();
    i.pin = { lat: LIMA.lat + 0.02, lng: LIMA.lng }; // ~2,2 km
    const r = computePresence(i);
    expect(r.band).toBe("LOW");
    expect(r.reasons).toContain("OUT_OF_RADIUS");
  });

  it("la ubicación simulada hunde la puntuación", () => {
    const i = base();
    i.signals.mockLocation = true;
    expect(computePresence(i).band).toBe("LOW");
  });

  it("sin atestación verificada queda como máximo en banda media", () => {
    const i = base();
    i.attestation = "UNAVAILABLE";
    expect(computePresence(i).band).toBe("MEDIUM");
  });

  it("detecta un 'teletransporte'", () => {
    const i = base();
    i.signals.recentFixes = [{ lat: -16.4, lng: -71.5, fixTime: "2026-09-29T09:59:00Z" }]; // Arequipa hace 1 min
    const r = computePresence(i);
    expect(r.reasons).toContain("IMPLAUSIBLE_MOVEMENT");
    expect(r.band).not.toBe("HIGH");
  });

  it("un reporte offline tardío se marca como testimonio tardío", () => {
    const i = base();
    i.capturedOffline = true;
    i.receivedAt = new Date("2026-09-29T12:00:00Z");
    const r = computePresence(i);
    expect(r.lateOffline).toBe(true);
    expect(r.reasons).toContain("LATE_OFFLINE_SUBMISSION");
  });
});

describe("deduplicación", () => {
  const t0 = new Date("2026-09-29T10:00:00Z");
  const input = {
    categoryCode: "accident.traffic",
    point: LIMA,
    observedAt: t0,
    dedupRadiusM: 500,
    dedupWindowMinutes: 120,
    compatibleWith: ["infra.road_blocked"],
  };

  it("cuatro reportes del mismo accidente van al mismo evento", () => {
    const event = { id: "e1", categoryCode: "accident.traffic", point: LIMA, lastActivityAt: t0 };
    for (const [dLat, dMin] of [[0.0003, 2], [0.0006, 5], [-0.0004, 9]] as const) {
      const d = decideDedup(
        { ...input, point: { lat: LIMA.lat + dLat, lng: LIMA.lng }, observedAt: new Date(t0.getTime() + dMin * 60000) },
        [event],
      );
      expect(d).toEqual({ kind: "ATTACH", eventId: "e1", score: expect.any(Number) });
    }
  });

  it("un evento lejano o antiguo no se fusiona", () => {
    const far = { id: "far", categoryCode: "accident.traffic", point: { lat: LIMA.lat + 0.05, lng: LIMA.lng }, lastActivityAt: t0 };
    const old = { id: "old", categoryCode: "accident.traffic", point: LIMA, lastActivityAt: new Date(t0.getTime() - 5 * 3600_000) };
    expect(decideDedup(input, [far, old]).kind).toBe("NEW");
  });

  it("categorías incompatibles no se fusionan", () => {
    const fire = { id: "f", categoryCode: "fire.structure", point: LIMA, lastActivityAt: t0 };
    expect(decideDedup(input, [fire]).kind).toBe("NEW");
  });

  it("dos eventos casi idénticos producen un caso ambiguo en vez de adivinar", () => {
    const a = { id: "a", categoryCode: "accident.traffic", point: LIMA, lastActivityAt: t0 };
    const b = { id: "b", categoryCode: "accident.traffic", point: { lat: LIMA.lat + 0.0001, lng: LIMA.lng }, lastActivityAt: t0 };
    expect(decideDedup(input, [a, b]).kind).toBe("AMBIGUOUS");
  });

  it("extrae palabras clave sin tildes ni palabras vacías", () => {
    expect(extractKeywords("Choque de dos autos en la Avenida Javier Prado")).toEqual(["choque", "dos", "autos", "avenida", "javier", "prado"]);
  });
});

describe("país por coordenadas (offline)", () => {
  const fc = JSON.parse(readFileSync(new URL("../../../data/countries/countries-50m.geojson", import.meta.url), "utf8")) as {
    features: CountryFeature[];
  };
  const locator = new CountryLocator(fc.features);

  it.each([
    [LIMA, "PE"],
    [{ lat: -13.5319, lng: -71.9675 }, "PE"], // Cusco
    [{ lat: -3.7437, lng: -73.2516 }, "PE"], // Iquitos
    [{ lat: -33.4489, lng: -70.6693 }, "CL"],
    [{ lat: 4.711, lng: -74.0721 }, "CO"],
    [{ lat: 40.4168, lng: -3.7038 }, "ES"],
    [{ lat: 35.6762, lng: 139.6503 }, "JP"],
  ])("%j → %s", (p, iso) => {
    expect(locator.locate(p)).toBe(iso);
  });

  it("un punto en la costa (Callao) se asigna al país más cercano", () => {
    expect(locator.locate({ lat: -12.07, lng: -77.16 })).toBe("PE");
  });

  it("alta mar devuelve null", () => {
    expect(locator.locate({ lat: -20, lng: -100 })).toBeNull();
  });
});
