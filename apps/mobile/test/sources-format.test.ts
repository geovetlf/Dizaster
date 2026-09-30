import type { AdminSourceView } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { sortSources, sourceAction, validReason } from "../src/lib/admin/sources-format";

const s = (key: string, over: Partial<AdminSourceView>): AdminSourceView => ({
  key, name: key, trustTier: "EXTERNAL", status: "ACTIVE", countryScope: [], urgentCapable: false, health: "OK", consecutiveFailures: 0,
  breakerOpenUntil: null, lastRunAt: null, lastOkAt: null, lastError: null, runsOk: 0, runsFailed: 0, itemsNew: 0, lastStatusChange: null, ...over,
});

describe("fuentes en administración (ADR 0162)", () => {
  it("ordena lo caído primero y las urgentes antes", () => {
    const out = sortSources([s("b", {}), s("a", { health: "IDLE", status: "PAUSED" }), s("c", { health: "DOWN" }), s("d", { urgentCapable: true }), s("e", { health: "FAILING" })]);
    expect(out.map((x) => x.key)).toEqual(["c", "e", "d", "b", "a"]);
  });
  it("solo pausa activas y reanuda pausadas", () => {
    expect(sourceAction({ status: "ACTIVE" })).toBe("PAUSE");
    expect(sourceAction({ status: "PAUSED" })).toBe("RESUME");
    expect(sourceAction({ status: "PLANNED" })).toBeNull();
    expect(sourceAction({ status: "RETIRED" })).toBeNull();
    expect(validReason("  ab ")).toBe(false);
    expect(validReason("mantenimiento")).toBe(true);
  });
});
