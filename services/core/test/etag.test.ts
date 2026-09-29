import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ifNoneMatch, weakEtag } from "../src/http/app.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

// ETag + If-None-Match en recursos cacheables (ADR 0084). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("etag", () => {
  it("un GET cacheable lleva etag y la repetición condicional da 304 sin cuerpo", async () => {
    const first = await t.app.inject({ url: "/v1/reference/categories" });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/".+"$/);
    const again = await t.app.inject({ url: "/v1/reference/categories", headers: { "if-none-match": etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
    expect(again.headers.etag).toBe(etag);
    const other = await t.app.inject({ url: "/v1/reference/categories", headers: { "if-none-match": 'W/"otro"' } });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual(first.json());
  });

  it("el etag cambia si cambia el cuerpo", async () => {
    const a = await t.app.inject({ url: "/v1/reference/emergency-numbers?country=PE" });
    const b = await t.app.inject({ url: "/v1/reference/emergency-numbers" });
    expect(a.headers.etag).toBeTruthy();
    expect(a.headers.etag).not.toBe(b.headers.etag);
  });

  it("no-store y errores no llevan etag", async () => {
    const u = await createUser(t, "etag_user");
    const sessions = await t.app.inject({ url: "/v1/me/sessions", headers: { authorization: `Bearer ${u.token}` } });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.headers.etag).toBeUndefined();
    const bad = await t.app.inject({ url: "/v1/events/tiles/30/0/0" });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers.etag).toBeUndefined();
  });

  it("comparación débil, listas y comodín", () => {
    const e = weakEtag("hola");
    expect(e).toBe(weakEtag(Buffer.from("hola")));
    expect(ifNoneMatch(undefined, e)).toBe(false);
    expect(ifNoneMatch("*", e)).toBe(true);
    expect(ifNoneMatch(`"x", ${e.slice(2)}`, e)).toBe(true);
    expect(ifNoneMatch('W/"x"', e)).toBe(false);
  });
});
