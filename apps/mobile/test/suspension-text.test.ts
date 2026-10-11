import { describe, expect, it } from "vitest";
import { actionReasonText, SUSPENSION_DURATIONS, suspensionText } from "../src/lib/moderation/logic";

const tr = (k: string) => `[${k}]`;

describe("suspensiones escalonadas en la app (ADR 0319)", () => {
  it("ofrece las tres duraciones aprobadas, en orden", () => {
    expect(SUSPENSION_DURATIONS).toEqual(["HOURS_24", "DAYS_7", "PERMANENT"]);
  });

  it("muestra la duración y, si tiene fin, hasta cuándo", () => {
    expect(suspensionText({}, "es", tr as never)).toBeNull();
    expect(suspensionText({ suspension: { duration: "PERMANENT", until: null } }, "es", tr as never)).toBe("[suspension_PERMANENT]");
    const text = suspensionText({ suspension: { duration: "DAYS_7", until: "2026-10-18T19:05:00.000Z" } }, "es", tr as never)!;
    expect(text.startsWith("[suspension_DAYS_7] · [suspensionUntil] ")).toBe(true);
    expect(text).toMatch(/18/);
  });

  it("la reactivación automática se explica en el idioma de la persona", () => {
    const rule = { actor: "RULE" as const, action: "UNSUSPEND_USER" as const, reason: "La suspensión terminó al cumplir su plazo" };
    expect(actionReasonText(rule, "en", tr as never)).toBe("[ruleReason_UNSUSPEND_USER]");
  });
});
