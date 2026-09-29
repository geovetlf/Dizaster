import { describe, expect, it } from "vitest";
import { rewriteSharedLinkPath } from "../src/lib/links";

// Enlaces compartidos /e/ y /p/ (ADR 0083).
const ID = "01a0ed4b-ae20-741a-a8d1-ad06459ad30d";

describe("enlaces compartidos", () => {
  it("traduce /e/ y /p/, con o sin dominio y con parámetros", () => {
    expect(rewriteSharedLinkPath(`/e/${ID}`)).toBe(`/event/${ID}`);
    expect(rewriteSharedLinkPath(`https://dizaster.example/p/${ID.toUpperCase()}?utm=x`)).toBe(`/post/${ID}`);
    expect(rewriteSharedLinkPath(`/p/${ID}/`)).toBe(`/post/${ID}`);
  });

  it("deja igual lo demás y rechaza ids mal formados", () => {
    expect(rewriteSharedLinkPath(`/event/${ID}`)).toBe(`/event/${ID}`);
    expect(rewriteSharedLinkPath("/e/../../admin-cost")).toBe("/e/../../admin-cost");
    expect(rewriteSharedLinkPath("/p/123")).toBe("/p/123");
  });
});
