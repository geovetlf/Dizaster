import { describe, expect, it } from "vitest";
import { actionsFor, canBlock, FLAG_REASONS, isSevere, reasonSummary, validReason } from "../src/lib/moderation/logic";

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
