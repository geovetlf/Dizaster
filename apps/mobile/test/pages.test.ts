import { describe, expect, it } from "vitest";
import { appendPage, newestFirst, pageQuery } from "../src/lib/ui/pages";

// Páginas con cursor (ADR 0106).
describe("páginas", () => {
  it("añade sin repetir y conserva el orden", () => {
    expect(appendPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("ordena de lo más reciente a lo más antiguo, con empate por id", () => {
    const e = [{ id: "1", at: "2026-09-29T10:00:00Z" }, { id: "3", at: "2026-09-29T11:00:00Z" }, { id: "2", at: "2026-09-29T10:00:00Z" }];
    expect(newestFirst(e).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });

  it("arma la query solo con lo que viene", () => {
    expect(pageQuery({})).toBe("");
    expect(pageQuery({ limit: 12, order: "desc", cursor: null })).toBe("?limit=12&order=desc");
    expect(pageQuery({ limit: 50, cursor: "abc" })).toBe("?limit=50&cursor=abc");
  });
});
