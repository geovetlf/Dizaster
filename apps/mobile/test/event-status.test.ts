import { describe, expect, it } from "vitest";
import { t, tf } from "../src/lib/i18n";
import { eventStatusLine, MAP_CIRCLE_RADIUS } from "../src/lib/ui/event-status";

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
