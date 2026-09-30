import { describe, expect, it } from "vitest";
import { DRAFT_MAX_AGE_MS, draftIsFresh, draftWorthKeeping, orphanMedia, referencedUris, type ReportDraft } from "../src/lib/report/draft";

// Borrador de reporte en el teléfono (ADR 0191). NO AI REQUIRED.
const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({ v: 1, categoryCode: "natural.flood", text: "", pseudonymous: false, media: [], targetEventId: null, savedAt: 0, ...over });

describe("borrador de reporte", () => {
  it("caduca a las 24 h y solo se guarda si tiene contenido o una captura en curso", () => {
    expect(draftIsFresh(draft(), DRAFT_MAX_AGE_MS)).toBe(true);
    expect(draftIsFresh(draft(), DRAFT_MAX_AGE_MS + 1)).toBe(false);
    expect(draftIsFresh(null, 0)).toBe(false);
    expect(draftWorthKeeping(draft({ text: "  " }))).toBe(false);
    expect(draftWorthKeeping(draft({ text: "agua en la calle" }))).toBe(true);
    expect(draftWorthKeeping(draft({ pendingCapture: { source: "camera", kind: "IMAGE" } }))).toBe(true);
  });

  it("no guarda la ubicación", () => {
    expect(Object.keys(draft())).not.toEqual(expect.arrayContaining(["pin"]));
    expect(JSON.stringify(draft())).not.toMatch(/lat|lng|coords/);
  });

  it("media huérfana: sin dueño y con más de una hora; nunca lo referenciado ni lo reciente", () => {
    const now = 10 * 3600_000;
    const files = [
      { uri: "a.jpg", modifiedAt: 0 },
      { uri: "b.jpg", modifiedAt: 0 },
      { uri: "b_poster.jpg", modifiedAt: 0 },
      { uri: "c.jpg", modifiedAt: now - 60_000 },
      { uri: "d.jpg", modifiedAt: null },
    ];
    const refs = new Set(referencedUris([{ localUri: "b.jpg", poster: { localUri: "b_poster.jpg", sizeBytes: 1, sha256: "x" } }]));
    expect(orphanMedia(files, refs, now)).toEqual(["a.jpg"]);
  });
});
