import { describe, expect, it } from "vitest";
import {
  badgeText, cycle, deliveryNoteKey, devicePrefsPatch, formatMinutes, permissionView, QUIET_PRESETS, quietLabel, routeForNotificationUrl, sameQuiet,
  NEAR_ME_MIN_INTERVAL_MS, roundForUpload, shouldSendNearMe, zoneKindInfo, zoneTitle,
} from "../src/lib/alerts/logic";

const ID = "01a0ebfd-052d-724a-aaa4-93d0dbec0a7f";

describe("deep link desde el aviso", () => {
  it("abre el EVENT o el historial y nada más", () => {
    expect(routeForNotificationUrl(`dizaster://event/${ID}`)).toBe(`/event/${ID}`);
    expect(routeForNotificationUrl(`dizaster://event/${ID.toUpperCase()}`)).toBe(`/event/${ID}`);
    expect(routeForNotificationUrl(`dizaster://post/${ID}`)).toBe(`/post/${ID}`);
    expect(routeForNotificationUrl("dizaster://post/abc")).toBeNull();
    expect(routeForNotificationUrl("dizaster://alerts")).toBe("/alerts");
    expect(routeForNotificationUrl("dizaster://admin-cost")).toBe("/admin-cost");
    expect(routeForNotificationUrl("dizaster://admin-quality")).toBe("/admin-quality");
    expect(routeForNotificationUrl("dizaster://my-moderation")).toBe("/my-moderation");
    for (const bad of [undefined, 42, "", "https://evil.example/event/x", "dizaster://event/../u/admin", "dizaster://event/abc", `dizaster://u/${ID}`, `dizaster://event/${ID}/extra`]) {
      expect(routeForNotificationUrl(bad)).toBeNull();
    }
  });
});

describe("permiso de notificaciones", () => {
  it("distingue pedir, concedido y bloqueado (solo desde Ajustes)", () => {
    expect(permissionView({ granted: true, canAskAgain: false })).toBe("granted");
    expect(permissionView({ granted: false, canAskAgain: true })).toBe("ask");
    expect(permissionView({ granted: false, canAskAgain: false })).toBe("blocked");
  });
});

describe("preferencias", () => {
  it("formatea y recorre horas de silencio", () => {
    expect(formatMinutes(22 * 60)).toBe("22:00");
    expect(formatMinutes(7 * 60 + 5)).toBe("07:05");
    expect(quietLabel(null, "No")).toBe("No");
    expect(quietLabel({ start: 1320, end: 420 }, "No")).toBe("22:00–07:00");
    expect(cycle(QUIET_PRESETS, null, sameQuiet)).toEqual({ start: 1320, end: 420 });
    expect(cycle(QUIET_PRESETS, { start: 0, end: 480 }, sameQuiet)).toBeNull();
    expect(cycle(QUIET_PRESETS, { start: 60, end: 120 }, sameQuiet)).toBeNull();
    expect(cycle([1, 2, 3, 4, 5], 5)).toBe(1);
  });

  it("sincroniza zona horaria e idioma del teléfono solo si cambiaron", () => {
    expect(devicePrefsPatch({ timezone: "America/Lima", lang: "es" }, { timezone: "America/Lima", lang: "es" })).toBeNull();
    expect(devicePrefsPatch({ timezone: "UTC", lang: "es" }, { timezone: "America/Lima", lang: "en" })).toEqual({ timezone: "America/Lima", lang: "en" });
    expect(devicePrefsPatch({ timezone: "UTC", lang: "es" }, { timezone: undefined, lang: "es" })).toBeNull();
  });
});

describe("historial", () => {
  it("explica por qué una alerta no sonó y limita el contador", () => {
    expect(deliveryNoteKey("SENT")).toBeNull();
    expect(deliveryNoteKey("GROUPED")).toBeNull();
    expect(deliveryNoteKey("SILENT_QUIET_HOURS")).toBe("deliveryQuiet");
    expect(deliveryNoteKey("SILENT_RATE_LIMIT")).toBe("deliveryRateLimit");
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");
  });
});

describe("zonas y cerca de mí", () => {
  it("envía la ubicación aproximada como mucho cada 30 minutos y solo si está activado", () => {
    const now = 1_000_000_000;
    expect(shouldSendNearMe(false, null, now)).toBe(false);
    expect(shouldSendNearMe(true, null, now)).toBe(true);
    expect(shouldSendNearMe(true, now - NEAR_ME_MIN_INTERVAL_MS + 1, now)).toBe(false);
    expect(shouldSendNearMe(true, now - NEAR_ME_MIN_INTERVAL_MS, now)).toBe(true);
  });

  it("redondea a ~1 km antes de enviar", () => {
    expect(roundForUpload({ lat: -12.16861, lng: -77.02471 })).toEqual({ lat: -12.17, lng: -77.02 });
  });

  it("nombre visible de una zona", () => {
    const label = (k: string) => ({ zoneHOME: "Casa", zoneOTHER: "Otra" })[k] ?? k;
    expect(zoneTitle({ kind: "HOME", name: null }, label)).toBe("Casa");
    expect(zoneTitle({ kind: "HOME", name: "  " }, label)).toBe("Casa");
    expect(zoneTitle({ kind: "WORK", name: "Oficina" }, label)).toBe("Oficina");
    expect(zoneKindInfo("RARO").kind).toBe("OTHER");
  });
});

describe("preferencias por zona (ADR 0154)", () => {
  it("alterna categorías y resume solo lo que filtra", async () => {
    const { toggleZoneCategory, zonePrefsSummary } = await import("../src/lib/alerts/logic");
    expect(toggleZoneCategory([], "fire")).toEqual(["fire"]);
    expect(toggleZoneCategory(["fire", "accident"].sort(), "fire")).toEqual(["accident"]);
    expect(toggleZoneCategory(["fire"], "accident")).toEqual(["accident", "fire"]);
    const name = (c: string) => ({ fire: "Incendios", accident: "Accidentes" })[c] ?? c;
    expect(zonePrefsSummary({ minSeverity: 1, categories: [] }, name)).toBeNull();
    expect(zonePrefsSummary({ minSeverity: 3, categories: ["fire"] }, name)).toBe("≥ 3/5 · Incendios");
    expect(zonePrefsSummary({ minSeverity: 1, categories: ["accident", "fire"] }, name)).toBe("Accidentes, Incendios");
  });
});
