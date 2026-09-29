import { describe, expect, it } from "vitest";
import { actionsFor, canBlock, FLAG_REASONS, isSevere, reasonSummary, validReason } from "../src/lib/moderation/logic";
import type { ModeratorEvidenceView, NearbyEvent } from "@dizaster/contracts";
import { canSplit, duplicateCandidates, toggle } from "../src/lib/moderation/event-tools";

describe("moderación (lógica de la app)", () => {
  it("acciones por tipo y confirmación de las graves", () => {
    expect(actionsFor("EVENT")).toEqual(["MARK_DISPUTED", "DISMISS"]);
    expect(actionsFor("PROFILE")).not.toContain("REMOVE");
    expect(isSevere("REMOVE")).toBe(true);
    expect(isSevere("HIDE")).toBe(false);
    expect(validReason("corto")).toBe(false);
    expect(validReason("  motivo suficientemente largo ")).toBe(true);
  });

  it("solo se bloquea a autores con nombre que no son uno mismo", () => {
    expect(canBlock({ pseudonymous: true }, "yo")).toBe(false);
    expect(canBlock({ pseudonymous: false, handle: "Yo" }, "yo")).toBe(false);
    expect(canBlock({ pseudonymous: false, handle: "otra" }, "yo")).toBe(true);
    expect(canBlock({ pseudonymous: false, handle: "otra" }, null)).toBe(true);
  });

  it("resume motivos de más a menos", () => {
    expect(FLAG_REASONS[0]).toBe("PRIVACY");
    expect(reasonSummary({ SPAM: 1, PRIVACY: 4, OTHER: 1 }, (r) => r.toLowerCase())).toBe("privacy 4 · spam 1 · other 1");
  });
});

describe("herramientas de evento (fusionar y dividir)", () => {
  const ev = (id: string) => ({ id }) as unknown as NearbyEvent;
  const evidence = (id: string) => ({ id }) as unknown as ModeratorEvidenceView;

  it("los duplicados posibles excluyen el propio evento y se acotan", () => {
    expect(duplicateCandidates([ev("a"), ev("b"), ev("c")], "b").map((e) => e.id)).toEqual(["a", "c"]);
    expect(duplicateCandidates([ev("a"), ev("c"), ev("d")], "x", 2)).toHaveLength(2);
  });

  it("dividir exige elegir algo y dejar al menos una evidencia", () => {
    const all = [evidence("1"), evidence("2")];
    expect(canSplit(new Set(), all)).toBe(false);
    expect(canSplit(new Set(["1"]), all)).toBe(true);
    expect(canSplit(new Set(["1", "2"]), all)).toBe(false);
    expect(canSplit(new Set(["1", "9"]), all)).toBe(true);
    expect([...toggle(toggle(new Set(["1"]), "2"), "1")]).toEqual(["2"]);
  });
});
