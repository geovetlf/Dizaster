import { describe, expect, it } from "vitest";
import { formatObserved, formatRate, sloTone } from "../src/lib/admin/quality-format";

describe("tablero de calidad", () => {
  it("colorea objetivos y formatea valores observados", () => {
    expect(sloTone({ ok: true })).toBe("ok");
    expect(sloTone({ ok: false })).toBe("over");
    expect(sloTone({ ok: null })).toBe("none");
    expect(formatObserved(null, "ms")).toBeNull();
    expect(formatObserved(200, "ms")).toBe("200 ms");
    expect(formatObserved(5001, "ms")).toBe("> 5 s");
    expect(formatObserved(50, "s")).toBe("50 s");
    expect(formatObserved(300, "s")).toBe("5.0 min");
    expect(formatObserved(30.25, "h")).toBe("30.3 h");
    expect(formatObserved(72, "h")).toBe("3.0 d");
    expect(formatRate(0.125)).toBe("12.5%");
    expect(formatRate(null)).toBe("—");
  });
});
