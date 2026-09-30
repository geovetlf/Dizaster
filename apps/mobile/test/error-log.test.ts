import { describe, expect, it } from "vitest";
import { appendEntry, parseLog, redact, toEntry, MAX_ERROR_ENTRIES } from "../src/lib/errors/error-log";

describe("registro local de errores (ADR 0161)", () => {
  it("redacta tokens, correos, coordenadas e ids", () => {
    const out = redact("Bearer abc.def-123 ana@correo.pe en -12.046374,-77.042793 evento 0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    expect(out).not.toMatch(/abc\.def|ana@|12\.0463|77\.0427|0190a1b2/);
    expect(out).toContain("Bearer ***");
  });

  it("guarda lo más reciente primero y con tope", () => {
    let log = parseLog(null);
    for (let i = 0; i < MAX_ERROR_ENTRIES + 5; i++) log = appendEntry(log, toEntry(new TypeError(`fallo ${i}`), null, new Date(1_700_000_000_000 + i)));
    expect(log).toHaveLength(MAX_ERROR_ENTRIES);
    expect(log[0]!.message).toBe(`TypeError: fallo ${MAX_ERROR_ENTRIES + 4}`);
    expect(parseLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(parseLog([{ nope: 1 }, "x"])).toEqual([]);
  });

  it("acepta cualquier cosa lanzada y recorta mensajes largos", () => {
    const e = toEntry("x".repeat(1000), "global", new Date(0));
    expect(e.message.length).toBeLessThanOrEqual(300);
    expect(e.where).toBe("global");
  });
});
