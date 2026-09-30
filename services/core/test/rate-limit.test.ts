import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/platform/rate-limit.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("límite general de peticiones (ADR 0047)", () => {
  it("ventana fija: corta al pasar el límite y se reinicia en la siguiente", () => {
    let now = 30_000;
    const l = new FixedWindowLimiter(2, 60_000, () => now);
    expect(l.hit("a")).toBeNull();
    expect(l.hit("a")).toBeNull();
    expect(l.hit("a")).toBe(30);
    expect(l.hit("b")).toBeNull();
    now = 60_000;
    expect(l.hit("a")).toBeNull();
  });

  describe("en la API", () => {
    let t: TestContext;
    beforeAll(async () => { t = await createTestContext({ env: { RATE_LIMIT_PER_MINUTE: "5", RATE_LIMIT_WRITES_PER_MINUTE: "3" } }); });
    afterAll(async () => { await t.close(); });

    it("sin sesión limita por IP y responde 429 con retry-after; /health no cuenta", async () => {
      for (let i = 0; i < 5; i++) expect((await t.app.inject({ url: "/v1/config", remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
      const res = await t.app.inject({ url: "/v1/config", remoteAddress: "10.0.0.1" });
      expect(res.statusCode).toBe(429);
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      expect((await t.app.inject({ url: "/v1/config", remoteAddress: "10.0.0.2" })).statusCode).toBe(200);
      expect((await t.app.inject({ url: "/health", remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    });

    it("con sesión limita por cuenta y las escrituras tienen un cupo menor", async () => {
      const u = await createUser(t, "limite_a");
      const auth = { authorization: `Bearer ${u.token}` };
      // createUser ya gastó una escritura (declarar la edad).
      const post = () => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth, remoteAddress: "10.0.0.9", payload: { text: "hola" } });
      expect((await post()).statusCode).toBe(201);
      expect((await post()).statusCode).toBe(201);
      expect((await post()).statusCode).toBe(429);
      // Otra IP no ayuda: el cupo es de la cuenta.
      expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth, remoteAddress: "10.0.0.10", payload: { text: "hola" } })).statusCode).toBe(429);
    });
  });
});

describe("tokens inválidos (ADR 0229)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext({ env: { RATE_LIMIT_PER_MINUTE: "3" } }); });
  afterAll(async () => { await t.close(); });

  it("una ráfaga de tokens falsos gasta el cupo de la IP y termina en 429", async () => {
    const bad = () => t.app.inject({ url: "/v1/config", headers: { authorization: "Bearer falso" }, remoteAddress: "10.1.1.1" });
    for (let i = 0; i < 3; i++) expect((await bad()).statusCode).toBe(401);
    expect((await bad()).statusCode).toBe(429);
    expect((await t.app.inject({ url: "/v1/config", remoteAddress: "10.1.1.2" })).statusCode).toBe(200);
  });
});
