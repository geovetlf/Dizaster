import { readFileSync } from "node:fs";
import type { EmergencyDataset, SubmitReportRequest } from "@dizaster/contracts";
import { SubmitReportRequest as SubmitSchema } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { lookupEmergency } from "../src/lib/emergency";
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
  it("reintenta errores de red y conserva el orden; elimina errores definitivos", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f81"), new Date("2026-09-29T10:00:00Z"));
    await q.enqueue(body("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f82"), new Date("2026-09-29T10:01:00Z"));
    const offline = await q.flush(async () => ({ ok: false, retryable: true, error: "Network request failed" }));
    expect(offline).toMatchObject({ sent: [], failed: 2, dropped: 0 });
    expect((await q.pending()).map((p) => p.attempts)).toEqual([1, 1]);

    const seen: string[] = [];
    const online = await q.flush(async (b) => {
      seen.push(b.clientReportId);
      return b.clientReportId.endsWith("81")
        ? { ok: true, response: { outcome: "CREATED_EVENT", reportId: b.clientReportId, postId: b.clientReportId, eventId: b.clientReportId, presenceBand: "HIGH" } }
        : { ok: false, retryable: false, error: "422" };
    });
    expect(seen).toEqual(["01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f81", "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f82"]);
    expect(online.sent).toHaveLength(1);
    expect(online.dropped).toBe(1);
    expect(await q.pending()).toEqual([]);
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
    });
    expect(p?.styleUrl("dark")).toBe("D");
    expect(providerFromAppConfig(null)).toBeNull();
    expect(OFFLINE_FALLBACK_STYLE.layers[0]?.type).toBe("background");
  });
});
