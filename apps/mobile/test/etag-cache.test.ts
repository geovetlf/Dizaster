import { describe, expect, it } from "vitest";
import { EtagCache } from "../src/lib/http/etag-cache";

// Caché de GET condicionales (ADR 0084). NO AI REQUIRED.
describe("EtagCache", () => {
  it("manda If-None-Match solo si hay algo guardado y devuelve el cuerpo en un 304", () => {
    const c = new EtagCache();
    expect(c.headers("/v1/config")).toEqual({});
    c.store("/v1/config", 'W/"a"', { v: 1 });
    expect(c.headers("/v1/config")).toEqual({ "if-none-match": 'W/"a"' });
    expect(c.hit("/v1/config")).toEqual({ v: 1 });
    expect(c.hit("/v1/otra")).toBeUndefined();
  });

  it("una respuesta sin etag borra lo guardado", () => {
    const c = new EtagCache();
    c.store("/x", 'W/"a"', 1);
    c.store("/x", null, 2);
    expect(c.headers("/x")).toEqual({});
  });

  it("acotada: descarta lo menos usado; clear vacía", () => {
    const c = new EtagCache(2);
    c.store("/a", 'W/"1"', 1);
    c.store("/b", 'W/"2"', 2);
    c.hit("/a");
    c.store("/c", 'W/"3"', 3);
    expect(c.hit("/b")).toBeUndefined();
    expect(c.hit("/a")).toBe(1);
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
  });
});
