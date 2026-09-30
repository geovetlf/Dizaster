import { describe, expect, it } from "vitest";
import { acceptBody, isUpdate, pendingPolicies } from "../src/lib/account/policies";

describe("términos y políticas (ADR 0176)", () => {
  const doc = (kind: "TERMS" | "PRIVACY" | "COMMUNITY_GUIDELINES", pending: boolean, required: boolean, accepted: string | null = null) =>
    ({ kind, version: "2", url: "https://example.org", required, acceptedVersion: accepted, pending });

  it("sin textos publicados no hay nada pendiente", () => {
    expect(pendingPolicies({ documents: [] })).toEqual([]);
    expect(pendingPolicies(null)).toEqual([]);
  });

  it("muestra lo pendiente, obligatorio primero, y acepta exactamente esas versiones", () => {
    const p = pendingPolicies({ documents: [doc("COMMUNITY_GUIDELINES", true, false), doc("PRIVACY", false, true, "2"), doc("TERMS", true, true, "1")] });
    expect(p.map((d) => d.kind)).toEqual(["TERMS", "COMMUNITY_GUIDELINES"]);
    expect(acceptBody(p)).toEqual({ accept: [{ kind: "TERMS", version: "2" }, { kind: "COMMUNITY_GUIDELINES", version: "2" }] });
    expect(isUpdate(p[0]!)).toBe(true);
    expect(isUpdate(p[1]!)).toBe(false);
  });
});
