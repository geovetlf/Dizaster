import { describe, expect, it } from "vitest";
import { DATA_EXPORT_ROW_LIMIT, capExportSections } from "../src/privacy.js";

describe("exportación con tope por lista (ADR 0295)", () => {
  it("recorta solo las listas que pasan el tope y las nombra", () => {
    const r = capExportSections({ social: { posts: [1, 2, 3], reactions: [1, 2] }, alerts: { notifications: [] } }, 2);
    expect(r.sections.social.posts).toEqual([1, 2]);
    expect(r.sections.social.reactions).toEqual([1, 2]);
    expect(r.sections.alerts.notifications).toEqual([]);
    expect(r.truncated).toEqual(["social.posts"]);
  });

  it("con todo por debajo del tope no marca nada", () => {
    expect(capExportSections({ media: { media: new Array(10).fill(0) } }).truncated).toEqual([]);
    expect(DATA_EXPORT_ROW_LIMIT).toBe(10_000);
  });
});
