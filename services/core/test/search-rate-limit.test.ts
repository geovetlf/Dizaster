import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

/** El cupo es por minuto de reloj: si falta poco para el cambio de minuto, se espera a que empiece uno nuevo. */
async function freshMinute(): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 10_000) await new Promise((r) => setTimeout(r, left + 50));
}

describe("cupo propio para búsquedas (ADR 0291)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext({ env: { SEARCH_RATE_LIMIT_PER_MINUTE: "3" } }); });
  afterAll(async () => { await t.close(); });

  it("sin sesión: la cuarta búsqueda del minuto recibe 429 con Retry-After; el resto de lecturas sigue", { timeout: 20_000 }, async () => {
    await freshMinute();
    const ip = { remoteAddress: "10.20.30.40" };
    for (const url of ["/v1/search/events?q=lluvia", "/v1/profiles?q=ana", "/v1/geo/areas?q=lima"]) {
      expect((await t.app.inject({ url, ...ip })).statusCode).not.toBe(429);
    }
    const blocked = await t.app.inject({ url: "/v1/tags?q=lima", ...ip });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await t.app.inject({ url: "/v1/businesses?q=pan", ...ip })).statusCode).toBe(429);
    // Lo que no es búsqueda no gasta ni choca con este cupo.
    expect((await t.app.inject({ url: "/v1/config", ...ip })).statusCode).toBe(200);
    expect((await t.app.inject({ url: "/v1/geo/datasets", ...ip })).statusCode).toBe(200);
    // Otra IP tiene su propio cupo.
    expect((await t.app.inject({ url: "/v1/search/events?q=lluvia", remoteAddress: "10.20.30.41" })).statusCode).not.toBe(429);
  });

  it("con sesión: el cupo es por cuenta", { timeout: 20_000 }, async () => {
    const u = await createUser(t, "busca_mucho");
    await freshMinute();
    const auth = { authorization: `Bearer ${u.token}` };
    for (let i = 0; i < 3; i++) expect((await t.app.inject({ url: `/v1/search/posts?q=agua${i}`, headers: auth })).statusCode).not.toBe(429);
    expect((await t.app.inject({ url: "/v1/search/posts?q=agua9", headers: auth })).statusCode).toBe(429);
    // Leer el feed no es una búsqueda.
    expect((await t.app.inject({ url: "/v1/feed", headers: auth })).statusCode).not.toBe(429);
  });
});
