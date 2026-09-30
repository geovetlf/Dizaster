import type { MyReportView } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { canWithdraw, myReportLines } from "../src/lib/report/my-reports";

const t = (k: string) => k;
const fmt = (iso: string) => iso.slice(0, 10);
const base: MyReportView = {
  id: "r", postId: "p", eventId: "e", categoryCode: "fire.structure", assertion: "OCCURRING", status: "ACCEPTED",
  capturedAt: "2026-09-01T10:00:00Z", receivedAt: "2026-09-01T10:00:05Z", capturedOffline: false,
  preciseLocationRemovesAt: "2026-10-01T10:00:00Z", preciseLocationRemovedAt: null, presenceReviews: 0, askSameEvent: false,
};

describe("myReportLines", () => {
  it("dice el estado y cuándo se borrará la ubicación precisa", () => {
    expect(myReportLines(base, t as never, fmt)).toEqual(["myReportStatus_ACCEPTED", "myReportPreciseRemoves 2026-10-01"]);
  });
  it("un reporte retirado dice cuándo se borró; muestra desmentido, consultas y envío sin conexión", () => {
    const r = { ...base, status: "WITHDRAWN" as const, assertion: "NOT_OCCURRING" as const, preciseLocationRemovesAt: null, preciseLocationRemovedAt: "2026-09-02T00:00:00Z", presenceReviews: 2, capturedOffline: true };
    expect(myReportLines(r, t as never, fmt)).toEqual([
      "myReportStatus_WITHDRAWN", "myReportDenial", "myReportPreciseRemoved 2026-09-02", "myReportReviews: 2", "myReportOffline",
    ]);
    expect(canWithdraw(r)).toBe(false);
    expect(canWithdraw(base)).toBe(true);
  });
});

describe("reportes sin enviar (ADR 0158)", () => {
  it("distingue esperar red, reintentar y detenido", async () => {
    const { queuedState } = await import("../src/lib/report/my-reports");
    expect(queuedState({ attempts: 0 })).toBe("WAITING_NETWORK");
    expect(queuedState({ attempts: 2 })).toBe("RETRYING");
    expect(queuedState({ attempts: 2, stuck: { reason: "422", at: "x" } })).toBe("STUCK");
  });
});
