import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CountryLocator,
  destinationPoint,
  clampToRadius,
  computePresence,
  PRESENCE_RULES_V1,
  PRESENCE_RULES_V2,
  textFingerprint,
  tileBounds,
  tilesForView,
  isValidTile,
  mergeMapTiles,
  MAX_TILES_PER_VIEW,
  decideDedup,
  DEDUP_RULES,
  hammingHex,
  matchScore,
  mediaSimilarity,
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

  it("el testimonio tardío pesa la mitad y no llega a HIGH; las reglas antiguas no lo descuentan (ADR 0108)", () => {
    const onTime = base();
    onTime.capturedOffline = true;
    onTime.receivedAt = new Date(onTime.capturedAt.getTime() + 10 * 60_000);
    const ok = computePresence(onTime);
    expect(ok.lateOffline).toBe(false);
    expect(ok.band).toBe("HIGH");
    expect(ok.breakdown["lateOfflineFactor"]).toBeUndefined();

    const late = { ...onTime, receivedAt: new Date("2026-09-29T12:00:00Z") };
    const r = computePresence(late);
    expect(r.score).toBeCloseTo(Math.min(ok.score * 0.5, 0.749), 3);
    expect(r.band).not.toBe("HIGH");
    expect(r.breakdown["lateOfflineFactor"]).toBe(0.5);
    expect(computePresence(late, PRESENCE_RULES_V2).score).toBe(ok.score);
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

  it("la misma foto acerca un caso dudoso; fotos distintas lo alejan (sim_media)", () => {
    const H = "f0f0f0f0f0f0f0f0";
    const near = "f0f0f0f0f0f0f0f1"; // 1 bit
    const other = "0f0f0f0f0f0f0f0f"; // 64 bits
    expect(hammingHex(H, near)).toBe(1);
    expect(mediaSimilarity([H], [near])).toBe(1);
    expect(mediaSimilarity([H], [other])).toBe(0);
    expect(mediaSimilarity([], [H])).toBe(0.5);
    // A 300 m y 60 min: sin fotos queda en la franja ambigua; con la misma foto, igual pero con más puntuación.
    const ev = { id: "e", categoryCode: "accident.traffic", point: { lat: LIMA.lat + 0.0027, lng: LIMA.lng }, lastActivityAt: new Date(t0.getTime() - 60 * 60000) };
    const base = matchScore(input, ev);
    expect(matchScore({ ...input, mediaHashes: [H] }, { ...ev, mediaHashes: [near] })).toBeCloseTo(base + 0.05, 3);
    expect(matchScore({ ...input, mediaHashes: [H] }, { ...ev, mediaHashes: [other] })).toBeCloseTo(base - 0.05, 3);
    expect(DEDUP_RULES.version).toBe("dedup-2");
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

describe("pin ajustable", () => {
  it("deja el pin donde está si está dentro del radio", () => {
    const p = { lat: LIMA.lat + 0.001, lng: LIMA.lng };
    expect(clampToRadius(LIMA, p, 300)).toEqual(p);
  });
  it("proyecta el pin al borde del radio permitido", () => {
    const far = { lat: LIMA.lat + 0.05, lng: LIMA.lng + 0.05 };
    const c = clampToRadius(LIMA, far, 300);
    expect(distanceMeters(LIMA, c)).toBeGreaterThan(295);
    expect(distanceMeters(LIMA, c)).toBeLessThanOrEqual(301);
  });
});

describe("presencia: bonificación por media capturada en la app (ADR 0073)", () => {
  const now = new Date("2026-09-29T10:00:30Z");
  // Señales flojas: GPS de 400 m y fix de hace ~16 min → banda media sin media.
  const weak = (): PresenceInput => ({
    pin: { lat: LIMA.lat + 0.0005, lng: LIMA.lng },
    signals: {
      fix: { ...LIMA, accuracyM: 400, fixTime: "2026-09-29T09:43:30Z", provider: "GNSS" },
      mockLocation: false, attestationToken: "x", recentFixes: [], deviceClock: "2026-09-29T10:00:28Z",
    },
    category: { presenceRadiusM: 300, offlineToleranceMinutes: 60 },
    capturedAt: new Date("2026-09-29T10:00:10Z"),
    capturedOffline: false,
    receivedAt: now,
    attestation: "GENUINE",
  });
  const photo = (capturedAt: string, serverSeenAt = "2026-09-29T10:00:20Z") => ({ capturedAt: new Date(capturedAt), serverSeenAt: new Date(serverSeenAt) });

  it("una foto de la cámara tomada junto al reporte suma evidencia", () => {
    expect(computePresence(weak()).band).toBe("MEDIUM");
    const r = computePresence({ ...weak(), mediaProofs: [photo("2026-09-29T10:00:00Z")] });
    expect(r.breakdown["mediaInApp"]).toBe(1);
    expect(r.band).toBe("HIGH");
    expect(r.ruleVersion).toBe("presence-3");
  });

  it("una foto vieja o con horas incoherentes no suma", () => {
    expect(computePresence({ ...weak(), mediaProofs: [photo("2026-09-29T08:00:00Z")] }).breakdown["mediaInApp"]).toBe(0);
    // El servidor vio la subida una hora antes de la supuesta captura: fecha retocada.
    expect(computePresence({ ...weak(), mediaProofs: [photo("2026-09-29T10:00:00Z", "2026-09-29T09:00:00Z")] }).breakdown["mediaInApp"]).toBe(0);
  });

  it("no rompe los topes de radio ni de atestación", () => {
    const far = { ...weak(), pin: { lat: LIMA.lat + 0.03, lng: LIMA.lng }, mediaProofs: [photo("2026-09-29T10:00:00Z")] };
    expect(computePresence(far).band).toBe("LOW");
    const noAttest = { ...weak(), attestation: "UNAVAILABLE" as const, mediaProofs: [photo("2026-09-29T10:00:00Z")] };
    expect(computePresence(noAttest).band).not.toBe("HIGH");
  });

  it("presence-1 queda igual para auditar reportes viejos", () => {
    const r = computePresence({ ...weak(), mediaProofs: [photo("2026-09-29T10:00:00Z")] }, PRESENCE_RULES_V1);
    expect(r.band).toBe("MEDIUM");
    expect(r.ruleVersion).toBe("presence-1");
  });
});

describe("huella de texto (ADR 0074)", () => {
  it("normaliza mayúsculas, tildes y signos; ignora textos cortos", () => {
    expect(textFingerprint("¡Choque GRAVE en la Avenida!")).toBe(textFingerprint("choque grave en la avenida"));
    expect(textFingerprint("Incendio en el almacén central")).toBe("incendio en el almacen central");
    expect(textFingerprint("hay humo")).toBeNull();
    expect(textFingerprint(undefined)).toBeNull();
  });
});

describe("teselas del mapa (ADR 0078)", () => {
  it("límites XYZ y validación", () => {
    expect(tileBounds({ z: 0, x: 0, y: 0 }).map((v) => Math.round(v))).toEqual([-180, -85, 180, 85]);
    const [w, s, e, n] = tileBounds({ z: 1, x: 0, y: 1 });
    expect([w, e, n]).toEqual([-180, 0, 0]);
    expect(s).toBeCloseTo(-85.0511, 3);
    expect(isValidTile({ z: 2, x: 3, y: 3 })).toBe(true);
    expect(isValidTile({ z: 2, x: 4, y: 0 })).toBe(false);
    expect(isValidTile({ z: 25, x: 0, y: 0 })).toBe(false);
  });

  it("la misma zona da las mismas teselas aunque el bbox cambie un poco; baja el zoom si son demasiadas", () => {
    const a = tilesForView([-77.1, -12.1, -76.95, -11.98], 12);
    const b = tilesForView([-77.099, -12.098, -76.951, -11.981], 12.3);
    expect(a).toEqual(b);
    expect(a.every((t) => t.z === 12)).toBe(true);
    for (const t of a) {
      const [w, s, e, n] = tileBounds(t);
      expect(w < -76.95 && e > -77.1 && s < -11.98 && n > -12.1).toBe(true);
    }
    const wide = tilesForView([-82, -19, -68, 0], 12);
    expect(wide.length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW);
    expect(wide[0]!.z).toBeLessThan(12);
    // Cruce del antimeridiano.
    const fiji = tilesForView([177, -20, -178, -15], 5);
    expect(new Set(fiji.map((t) => t.x))).toEqual(new Set([31, 0]));
  });

  it("une teselas: evento repetido en el borde una vez, cluster partido sumado", () => {
    const ev = { id: "e1" } as never;
    expect(mergeMapTiles([
      { mode: "points", events: [ev], clusters: [] },
      { mode: "points", events: [ev], clusters: [] },
    ]).events).toHaveLength(1);
    const c = (count: number, sev: number) => ({ h3: "8a", point: { lat: 0, lng: 0 }, count, maxSeverity: sev });
    expect(mergeMapTiles([
      { mode: "clusters", events: [], clusters: [c(2, 1)] },
      { mode: "clusters", events: [], clusters: [c(3, 4)] },
    ]).clusters).toEqual([c(5, 4)]);
  });
});

describe("destinationPoint (ADR 0087)", () => {
  it("vuelve a la distancia pedida en cualquier rumbo y cruza el antimeridiano", () => {
    const from = { lat: -12.05, lng: -77.04 };
    for (const b of [0, 45, 90, 180, 270]) expect(Math.abs(distanceMeters(from, destinationPoint(from, 10_000, b)) - 10_000)).toBeLessThan(1);
    expect(destinationPoint({ lat: 0, lng: 179.99 }, 5_000, 90).lng).toBeLessThan(-179);
  });
});
