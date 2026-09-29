import { describe, expect, it } from "vitest";
import { postAuthorLabel, postSnippet } from "../src/lib/social/post-search";

// Resultados de búsqueda de publicaciones (ADR 0107).
describe("fragmento de publicación", () => {
  it("deja igual un texto corto y aplana saltos", () => {
    expect(postSnippet("Agua\n\npotable  aquí", "agua")).toBe("Agua potable aquí");
    expect(postSnippet(null, "x")).toBe("");
  });

  it("corta en palabra y se centra en lo buscado", () => {
    const text = `${"palabra ".repeat(30)}reparten agua potable en la plaza ${"final ".repeat(20)}`;
    const s = postSnippet(text, "AGUA POTABLE", 60);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("agua potable");
    expect(s.length).toBeLessThanOrEqual(62);
  });

  it("firma con nombre o seudónimo", () => {
    expect(postAuthorLabel({ pseudonymous: false, handle: "ana", displayName: "Ana" }, "Anónimo")).toBe("Ana");
    expect(postAuthorLabel({ pseudonymous: true }, "Anónimo")).toBe("Anónimo");
  });
});
