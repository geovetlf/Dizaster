import { readFileSync } from "node:fs";
import { SUPPORTED_LANGS } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, alertText, decideAlerts, groupText, inQuietHours, wants } from "../src/modules/alert/index.js";

const snap = (over: Partial<Parameters<typeof decideAlerts>[1]> = {}) => ({
  id: "e1", severity: 3, publicState: "COMMUNITY_CORROBORATED" as const, publicationState: "PUBLISHED", status: "ACTIVE", categoryAlertable: true, ...over,
});
const seen = { publicState: "COMMUNITY_CORROBORATED", severity: 3, status: "ACTIVE", announced: true };

describe("decideAlerts", () => {
  it("no avisa de un reporte sin corroborar, ni de algo oculto o no alertable", () => {
    expect(decideAlerts(null, snap({ publicState: "UNVERIFIED" }))).toEqual([]);
    expect(decideAlerts(null, snap({ publicationState: "HIDDEN" }))).toEqual([]);
    expect(decideAlerts(null, snap({ categoryAlertable: false }))).toEqual([]);
    expect(decideAlerts(null, snap({ status: "RESOLVED" }))).toEqual([]);
  });

  it("anuncia una vez y luego solo cambios importantes", () => {
    expect(decideAlerts(null, snap())).toEqual([{ kind: "NEW_EVENT", dedupKey: "e1:NEW", critical: false }]);
    expect(decideAlerts(seen, snap())).toEqual([]);
    expect(decideAlerts(seen, snap({ severity: 3 }))).toEqual([]);
    expect(decideAlerts(seen, snap({ publicState: "OFFICIALLY_CONFIRMED", severity: 5 }))).toEqual([
      { kind: "STATE_CHANGED", dedupKey: "e1:STATE:OFFICIALLY_CONFIRMED", critical: true },
      { kind: "SEVERITY_UP", dedupKey: "e1:SEV:5", critical: false },
    ]);
    expect(decideAlerts(seen, snap({ publicState: "FALSE", severity: 5 })).map((d) => d.kind)).toEqual(["STATE_CHANGED"]);
    expect(decideAlerts(seen, snap({ status: "RESOLVED" }))).toEqual([{ kind: "RESOLVED", dedupKey: "e1:RESOLVED", critical: false }]);
  });

  it("un evento que no se anunció se anuncia al corroborarse, con su estado actual", () => {
    const unannounced = { ...seen, publicState: "UNVERIFIED", announced: false };
    expect(decideAlerts(unannounced, snap({ publicState: "OFFICIALLY_CONFIRMED", severity: 4 }))).toEqual([
      { kind: "NEW_EVENT", dedupKey: "e1:NEW", critical: true },
    ]);
  });
});

describe("wants", () => {
  it("respeta interruptores y severidad mínima", () => {
    const p = DEFAULT_PREFERENCES;
    expect(wants(p, "NEW_EVENT", "CATEGORY", 3)).toBe(true);
    expect(wants(p, "NEW_EVENT", "CATEGORY", 2)).toBe(false);
    expect(wants(p, "NEW_EVENT", "FOLLOWED_EVENT", 1)).toBe(true);
    expect(wants({ ...p, followedPlaces: false }, "NEW_EVENT", "FOLLOWED_PLACE", 5)).toBe(false);
    expect(wants({ ...p, statusChanges: false }, "STATE_CHANGED", "FOLLOWED_EVENT", 5)).toBe(false);
    expect(wants(p, "NEW_EVENT", "SAVED_ZONE", 3)).toBe(true);
    expect(wants({ ...p, savedZones: false }, "NEW_EVENT", "SAVED_ZONE", 5)).toBe(false);
    // "Cerca de mí" viene apagado por defecto: requiere que la persona lo active.
    expect(wants(p, "NEW_EVENT", "NEAR_ME", 5)).toBe(false);
    expect(wants({ ...p, nearMe: true }, "NEW_EVENT", "NEAR_ME", 2)).toBe(false);
    expect(wants({ ...p, nearMe: true }, "NEW_EVENT", "NEAR_ME", 3)).toBe(true);
    expect(wants({ ...p, followedEvents: false }, "RESOLVED", "FOLLOWED_EVENT", 5)).toBe(false);
    expect(wants({ ...p, followedEvents: false }, "RESOLVED", "PREVIOUSLY_ALERTED", 5)).toBe(true);
    expect(wants({ ...p, enabled: false }, "NEW_EVENT", "FOLLOWED_EVENT", 5)).toBe(false);
  });
});

describe("inQuietHours", () => {
  const at = (iso: string) => new Date(iso);
  it("usa la zona horaria de la persona y cruza medianoche", () => {
    const night = { quietHours: { start: 22 * 60, end: 7 * 60 }, timezone: "America/Lima" };
    expect(inQuietHours(at("2026-09-29T04:00:00Z"), night)).toBe(true); // 23:00 en Lima
    expect(inQuietHours(at("2026-09-29T11:59:00Z"), night)).toBe(true); // 06:59
    expect(inQuietHours(at("2026-09-29T12:00:00Z"), night)).toBe(false); // 07:00
    expect(inQuietHours(at("2026-09-29T20:00:00Z"), night)).toBe(false); // 15:00
    const siesta = { quietHours: { start: 13 * 60, end: 15 * 60 }, timezone: "UTC" };
    expect(inQuietHours(at("2026-09-29T14:00:00Z"), siesta)).toBe(true);
    expect(inQuietHours(at("2026-09-29T15:00:00Z"), siesta)).toBe(false);
    expect(inQuietHours(at("2026-09-29T14:00:00Z"), { quietHours: null, timezone: "UTC" })).toBe(false);
  });
});

describe("textos", () => {
  it("solo usan datos públicos y se traducen", () => {
    const base = { category: "Inundación", place: "Miraflores, Lima", state: "OFFICIALLY_CONFIRMED" as const, severity: 4 };
    expect(alertText("es", { ...base, kind: "NEW_EVENT" })).toEqual({ title: "Inundación en Miraflores, Lima", body: "Confirmado oficialmente · severidad 4/5" });
    expect(alertText("en", { ...base, category: "Flood", kind: "NEW_EVENT" })).toEqual({ title: "Flood in Miraflores, Lima", body: "Officially confirmed · severity 4/5" });
    expect(alertText("es", { ...base, place: null, kind: "RESOLVED" })).toEqual({ title: "Terminado: Inundación", body: "Confirmado oficialmente" });
    expect(groupText("es", ["a", "b", "c", "d", "e"])).toEqual({ title: "5 alertas nuevas", body: "a · b · c y 2 más" });
    expect(groupText("en", ["a", "b"])).toEqual({ title: "2 new alerts", body: "a · b" });
    expect(alertText("pt", { ...base, category: "Inundação", kind: "NEW_EVENT" })).toEqual({ title: "Inundação em Miraflores, Lima", body: "Confirmado oficialmente · gravidade 4/5" });
    expect(alertText("fr", { ...base, category: "Inondation", kind: "SEVERITY_UP" })).toEqual({ title: "Gravité en hausse : Inondation", body: "Miraflores, Lima · gravité 4/5" });
    expect(groupText("fr", ["a", "b", "c", "d"])).toEqual({ title: "4 nouvelles alertes", body: "a · b · c et 1 de plus" });
  });

  it("cada categoría del catálogo tiene nombre en todos los idiomas soportados", () => {
    const catalog = JSON.parse(readFileSync(new URL("../../../data/categories/categories.json", import.meta.url), "utf8")) as { categories: { code: string; names: Record<string, string> }[] };
    const emergency = JSON.parse(readFileSync(new URL("../../../data/emergency-numbers/emergency-numbers.json", import.meta.url), "utf8")) as { numbers: { label: Record<string, string> }[] };
    for (const l of SUPPORTED_LANGS) {
      expect(catalog.categories.filter((c) => !c.names[l]?.trim()).map((c) => c.code), l).toEqual([]);
      expect(emergency.numbers.filter((n) => !n.label[l]?.trim()).length, l).toBe(0);
    }
  });
});
