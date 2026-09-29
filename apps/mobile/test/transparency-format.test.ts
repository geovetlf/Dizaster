import type { TransparencyReport } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { formatHours, sortedActions, sortedCounts, transparencyText } from "../src/lib/admin/transparency-format";

const report: TransparencyReport = {
  period: { from: "2026-07-01T00:00:00Z", to: "2026-09-29T00:00:00Z", days: 90 },
  generatedAt: "2026-09-29T00:00:00Z",
  flags: { total: 42, byReason: { SPAM: 30, PRIVACY: "<5", HARASSMENT: 8, OTHER: 0 } },
  cases: { opened: 20, resolved: 15, dismissed: "<5", medianHoursToClose: 60 },
  actions: [
    { action: "HIDE", actor: "MODERATOR", targetType: "POST", count: "<5" },
    { action: "REMOVE", actor: "MODERATOR", targetType: "POST", count: 9 },
  ],
  reversals: 0,
  appeals: { received: "<5", upheld: 0, reversed: 0, open: "<5" },
  authorityRequests: { received: 0, byType: {} },
};

describe("informe de transparencia", () => {
  it("ordena sin convertir ni sumar las cifras protegidas", () => {
    expect(sortedCounts(report.flags.byReason)).toEqual([["SPAM", 30], ["HARASSMENT", 8], ["PRIVACY", "<5"]]);
    expect(sortedActions(report.actions).map((a) => a.action)).toEqual(["REMOVE", "HIDE"]);
    expect(formatHours(null)).toBe("—");
    expect(formatHours(5.25)).toBe("5.3 h");
    expect(formatHours(60)).toBe("2.5 d");
  });

  it("produce un texto para compartir con las cifras tal cual", () => {
    const id = (k: string) => k;
    const text = transparencyText(report, {
      title: "T", period: "P", flags: "F", cases: "C", opened: "o", resolved: "r", dismissed: "d", median: "m", actions: "A",
      reversals: "R", appeals: "Ap", received: "rec", upheld: "up", reversed: "rev", open: "op", authority: "Au", note: "N",
      reason: id, action: id, actor: id, target: id, authorityType: id,
    });
    expect(text).toContain("P: 2026-07-01 – 2026-09-29 (90 d)");
    expect(text).toContain("  PRIVACY: <5");
    expect(text).toContain("  REMOVE · POST · MODERATOR: 9");
    expect(text).toContain("C: o 20 · r 15 · d <5");
    expect(text).not.toContain("OTHER");
  });
});
