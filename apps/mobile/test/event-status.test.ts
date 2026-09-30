import { describe, expect, it } from "vitest";
import { t, tf } from "../src/lib/i18n";
import { eventStatusLine, eventWhenParts, MAP_CIRCLE_RADIUS } from "../src/lib/ui/event-status";

// Estado y gravedad del evento para el público (ADR 0222). NO AI REQUIRED.
describe("eventStatusLine", () => {
  it("estado del ciclo de vida y gravedad acotada a 1–5", () => {
    const line = eventStatusLine({ status: "MONITORING", severity: 4 }, t, tf);
    expect(line).toContain(t("st_MONITORING"));
    expect(line).toContain("4");
    expect(eventStatusLine({ status: "ACTIVE", severity: 9 }, t, tf)).toContain("5");
    expect(eventStatusLine({ status: "RESOLVED", severity: 0 }, t, tf)).toContain("1");
  });
  it("el radio del mapa usa reportes y gravedad", () => {
    expect(JSON.stringify(MAP_CIRCLE_RADIUS)).toContain('"count"');
    expect(JSON.stringify(MAP_CIRCLE_RADIUS)).toContain('"severity"');
  });
});

describe("eventWhenParts (ADR 0224)", () => {
  const fmt = (iso: string) => iso.slice(11, 16);
  it("hora del suceso y, si se supo mucho después, la de detección", () => {
    expect(eventWhenParts({ startedAt: "2026-09-30T08:00:00Z", firstSeenAt: "2026-09-30T11:30:00Z" }, fmt)).toEqual({ started: "08:00", detected: "11:30" });
    expect(eventWhenParts({ startedAt: "2026-09-30T11:25:00Z", firstSeenAt: "2026-09-30T11:30:00Z" }, fmt)).toEqual({ started: "11:25", detected: null });
  });
  it("sin hora del suceso, o una posterior a la detección, usa la de detección", () => {
    expect(eventWhenParts({ firstSeenAt: "2026-09-30T11:30:00Z" }, fmt)).toEqual({ started: "11:30", detected: null });
    expect(eventWhenParts({ startedAt: "2026-09-30T12:00:00Z", firstSeenAt: "2026-09-30T11:30:00Z" }, fmt)).toEqual({ started: "11:30", detected: null });
  });
});
