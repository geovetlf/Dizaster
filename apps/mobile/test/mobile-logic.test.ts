import { readFileSync } from "node:fs";
import type { EmergencyDataset, SubmitReportRequest } from "@dizaster/contracts";
import { SubmitReportRequest as SubmitSchema } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { compareDatasetVersions } from "@dizaster/contracts";
import { lookupEmergency, newestDataset, regionOf } from "../src/lib/emergency";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig } from "../src/lib/map/provider";
import { toPresenceSignals } from "../src/lib/report/presence";
import { MemoryQueueStorage, ReportQueue } from "../src/lib/report/queue";

const dataset = JSON.parse(readFileSync(new URL("../../../data/emergency-numbers/emergency-numbers.json", import.meta.url), "utf8")) as EmergencyDataset;

const loc = { coords: { latitude: -12.05, longitude: -77.04, accuracy: 6, altitude: null, speed: 0, heading: null }, timestamp: Date.parse("2026-09-29T10:00:00Z"), mocked: false };

function body(id: string): SubmitReportRequest {
  return SubmitSchema.parse({
    clientReportId: id, categoryCode: "accident.traffic", pin: { lat: -12.05, lng: -77.04 },
    presence: toPresenceSignals(loc, [], null, new Date("2026-09-29T10:00:01Z")), capturedAt: "2026-09-29T10:00:00Z",
  });
}

describe("señales de presencia", () => {
  it("genera un payload válido para el contrato del servidor", () => {
    const s = toPresenceSignals(loc, [], null);
    expect(s.fix).toMatchObject({ lat: -12.05, lng: -77.04, accuracyM: 6 });
    expect(s.mockLocation).toBe(false);
  });
  it("si el sistema no informa 'mocked' no se asume ubicación real", () => {
    const { mocked: _m, ...ios } = loc;
    expect(toPresenceSignals(ios, [], null).mockLocation).toBeNull();
  });
});

describe("cola offline", () => {
  it("sin red reintenta sin gastar intentos y conserva el orden; un error definitivo detiene sin borrar (ADR 0158)", async () => {
    const q = new ReportQueue(new MemoryQueueStorage(), 3);
    await q.enqueue(body("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f81"), new Date("2026-09-29T10:00:00Z"));
    await q.enqueue(body("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f82"), new Date("2026-09-29T10:01:00Z"));
    for (let i = 0; i < 5; i++) {
      const offline = await q.flush(async () => ({ ok: false, retryable: true, offline: true, error: "Network request failed" }));
      expect(offline).toMatchObject({ sent: [], failed: 2, stuck: 0, offline: true });
    }
    expect((await q.pending()).map((p) => p.attempts)).toEqual([0, 0]);

    const seen: string[] = [];
    const online = await q.flush(async (b) => {
      seen.push(b.clientReportId);
      return b.clientReportId.endsWith("81")
        ? { ok: true, response: { outcome: "CREATED_EVENT", reportId: b.clientReportId, postId: b.clientReportId, eventId: b.clientReportId, presenceBand: "HIGH" } }
        : { ok: false, retryable: false, error: "422" };
    });
    expect(seen).toEqual(["01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f81", "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f82"]);
    expect(online).toMatchObject({ failed: 0, stuck: 1, offline: false });
    const [left] = await q.pending();
    expect(left).toMatchObject({ clientReportId: "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f82", stuck: { reason: "422" } });
    // Detenido: no se reenvía solo.
    let calls = 0;
    expect(await q.flush(async () => { calls++; return { ok: false, retryable: true, error: "500" }; })).toMatchObject({ stuck: 1 });
    expect(calls).toBe(0);
    // Reintentar lo devuelve a la cola; descartar lo saca y lo entrega para borrar sus copias.
    await q.retry(left!.clientReportId);
    expect((await q.pending())[0]).toMatchObject({ attempts: 0 });
    expect((await q.pending())[0]!.stuck).toBeUndefined();
    expect((await q.discard(left!.clientReportId))?.clientReportId).toBe(left!.clientReportId);
    expect(await q.pending()).toEqual([]);
  });

  it("errores con red se reintentan hasta el máximo y entonces se detienen", async () => {
    const q = new ReportQueue(new MemoryQueueStorage(), 3);
    await q.enqueue(body("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f83"));
    const r500 = async () => ({ ok: false as const, retryable: true, error: "500" });
    expect(await q.flush(r500)).toMatchObject({ failed: 1, stuck: 0 });
    expect(await q.flush(r500)).toMatchObject({ failed: 1, stuck: 0 });
    expect(await q.flush(r500)).toMatchObject({ failed: 0, stuck: 1 });
    expect(await q.pending()).toHaveLength(1);
  });

  it("espera creciente entre reintentos automáticos, con techo", async () => {
    const { retryDelayMs } = await import("../src/lib/report/queue");
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, 120_000, 300_000]);
  });
});

describe("emergencia offline", () => {
  it("Perú devuelve sus números y avisa de que falta verificación oficial", () => {
    const r = lookupEmergency(dataset, "PE");
    expect(r.numbers.map((n) => n.number)).toEqual(expect.arrayContaining(["105", "116", "106"]));
    expect(r.unverified).toBe(true);
    expect(r.fallbackToGsm112).toBe(false);
  });
  it("país sin datos cae al 112 GSM con advertencia", () => {
    expect(lookupEmergency(dataset, "ZZ")).toMatchObject({ numbers: [], fallbackToGsm112: true });
  });
});

describe("proveedor de mapa desacoplado", () => {
  it("se construye desde la configuración remota y tiene un fondo offline", () => {
    const p = providerFromAppConfig({
      apiVersion: "v1",
      map: { id: "x", kind: "VECTOR_STYLE_URL", styleUrl: { light: "L", dark: "D" }, attribution: "© OSM", maxZoom: 18, offlineRegions: true },
      killSwitches: {}, limits: { maxVideoSeconds: 60, maxReportsPerHour: 10 }, referenceVersions: { categories: "c", emergencyNumbers: "e" },
      appUpdate: { android: { minVersion: null, storeUrl: null }, ios: { minVersion: null, storeUrl: null } },
    });
    expect(p?.styleUrl("dark")).toBe("D");
    expect(providerFromAppConfig(null)).toBeNull();
    expect(OFFLINE_FALLBACK_STYLE.layers[0]?.type).toBe("background");
  });
});

describe("números de emergencia incrementales (ADR 0039)", () => {
  it("compara versiones por tramos numéricos", () => {
    expect(compareDatasetVersions("emergency-2026.09.10", "emergency-2026.09.9")).toBe(1);
    expect(compareDatasetVersions("emergency-2026.09.1", "emergency-2026.10.1")).toBe(-1);
    expect(compareDatasetVersions("emergency-2026.09.1", "emergency-2026.09.1")).toBe(0);
  });

  it("usa el descargado solo si es más nuevo que el empaquetado", () => {
    const a = { version: "emergency-2026.09.1", numbers: [] };
    const b = { version: "emergency-2026.10.1", numbers: [] };
    expect(newestDataset(a, b)).toBe(b);
    expect(newestDataset(b, a)).toBe(b);
    expect(newestDataset(a, null)).toBe(a);
  });

  it("toma la región de los ajustes del teléfono", () => {
    expect(regionOf("es-PE")).toBe("PE");
    expect(regionOf("en_US")).toBe("US");
    expect(regionOf("zh-Hant-TW")).toBe("TW");
    expect(regionOf("es")).toBeNull();
  });
});
