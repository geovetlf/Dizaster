import { describe, expect, it } from "vitest";
import { actionsFor, appendNotices, canBlock, FLAG_REASONS, isSevere, presenceLines, reasonSummary, validReason } from "../src/lib/moderation/logic";
import type { ModerationNotice, ModeratorEvidenceView, NearbyEvent } from "@dizaster/contracts";
import { canSetNegative, canSplit, duplicateCandidates, toggle } from "../src/lib/moderation/event-tools";

describe("moderación (lógica de la app)", () => {
  it("acciones por tipo y confirmación de las graves", () => {
    expect(actionsFor("EVENT")).toEqual(["MARK_DISPUTED", "DISMISS"]);
    expect(actionsFor("PROFILE")).not.toContain("REMOVE");
    expect(actionsFor("PROFILE")).toContain("REMOVE_AVATAR");
    expect(actionsFor("PROFILE")).toContain("CLEAR_PROFILE_TEXT");
    expect(actionsFor("BUSINESS")).not.toContain("CLEAR_PROFILE_TEXT");
    expect(actionsFor("BUSINESS")).toContain("REMOVE_AVATAR");
    expect(actionsFor("POST")).not.toContain("REMOVE_AVATAR");
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

describe("presenceLines (ADR 0089)", () => {
  const tr = (k: string) => ({
    presenceBandLine: "{band} {score} {distance}m {attestation}", presencePrecise: "{lat},{lng} hasta {until}",
    presenceGeneralized: "generalizada", presencePrior: "antes {n}", presenceMediaProof: "{kind} -{s}s",
  })[k]!;
  const base = {
    reportId: "r", presenceBand: "HIGH", presenceScore: 0.8734, fixToPinM: 12.4, mockLocation: false, attestationVerdict: "GENUINE" as const,
    reasons: [], scoreBreakdown: {}, ruleVersion: "p1", preciseExpiresAt: "2026-10-29T00:00:00Z", generalizedAt: null, priorAccesses: 0,
    mediaCaptureProofs: [] as { mediaId: string; kind: string; capturedAt: string; serverSeenAt: string; secondsBeforeReport: number }[],
  };
  it("con ubicación precisa y sin accesos previos", () => {
    expect(presenceLines({ ...base, deviceFix: { lat: -12.046412345, lng: -77.04281 } }, tr as never)).toEqual([
      "HIGH 0.87 12m GENUINE", "-12.04641,-77.04281 hasta 2026-10-29",
    ]);
  });
  it("generalizada, con motivos y accesos previos", () => {
    expect(presenceLines({ ...base, deviceFix: null, mockLocation: true, reasons: ["LOW_ACCURACY"], priorAccesses: 2 }, tr as never)).toEqual([
      "HIGH 0.87 12m GENUINE", "MOCK_LOCATION", "LOW_ACCURACY", "generalizada", "antes 2",
    ]);
  });
  it("con pruebas de captura (ADR 0181)", () => {
    const proof = { mediaId: "m", kind: "IMAGE", capturedAt: "x", serverSeenAt: "y", secondsBeforeReport: 30 };
    expect(presenceLines({ ...base, deviceFix: null, mediaCaptureProofs: [proof] }, tr as never).at(-1)).toBe("IMAGE -30s");
  });
});

describe("canSetNegative (ADR 0096)", () => {
  const none = { negativeState: "NONE", level: "COMMUNITY_CORROBORATED" };
  it("FALSE exige evidencia seleccionada y no aplica a lo confirmado oficialmente", () => {
    expect(canSetNegative("FALSE", none, 0)).toBe(false);
    expect(canSetNegative("FALSE", none, 1)).toBe(true);
    expect(canSetNegative("FALSE", { ...none, level: "OFFICIALLY_CONFIRMED" }, 2)).toBe(false);
  });
  it("DISPUTED y NONE no piden evidencia; no se repite el estado actual", () => {
    expect(canSetNegative("DISPUTED", none, 0)).toBe(true);
    expect(canSetNegative("NONE", none, 0)).toBe(false);
    expect(canSetNegative("NONE", { ...none, negativeState: "FALSE" }, 0)).toBe(true);
  });
});

describe("sensibilidad por contexto (ADR 0179)", () => {
  it("solo ofrece subir", async () => {
    const { raisableSensitivities } = await import("../src/lib/moderation/event-tools");
    expect(raisableSensitivities("NORMAL")).toEqual(["SENSITIVE", "HIGHLY_SENSITIVE"]);
    expect(raisableSensitivities("SENSITIVE")).toEqual(["HIGHLY_SENSITIVE"]);
    expect(raisableSensitivities("HIGHLY_SENSITIVE")).toEqual([]);
  });
});

describe("avisos de moderación por páginas (ADR 0289)", () => {
  const n = (id: string, canAppeal = true) => ({ action: { id }, appeal: null, canAppeal }) as unknown as ModerationNotice;
  it("añade la página siguiente sin repetir avisos ya mostrados", () => {
    const first = [n("a"), n("b", false)];
    const merged = appendNotices(first, [n("b"), n("c")]);
    expect(merged.map((x) => x.action.id)).toEqual(["a", "b", "c"]);
    // El que ya estaba se conserva tal cual (p. ej. recién apelado).
    expect(merged[1]!.canAppeal).toBe(false);
  });
});
