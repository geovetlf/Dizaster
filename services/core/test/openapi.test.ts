import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

type Doc = { openapi: string; paths: Record<string, Record<string, { "x-undocumented"?: boolean; security?: unknown; requestBody?: unknown }>> };

describe("contrato OpenAPI (ADR 0052)", () => {
  let t: TestContext;
  let doc: Doc;
  beforeAll(async () => {
    t = await createTestContext({ env: { DEV_AUTH_ENABLED: "true" } });
    doc = (await t.app.inject({ method: "GET", url: "/v1/openapi.json" })).json();
  });
  afterAll(async () => { await t.close(); });

  it("documenta todas las rutas registradas y ninguna que no exista", async () => {
    expect(doc.openapi).toBe("3.1.0");
    const undocumented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.entries(ops).filter(([, o]) => o["x-undocumented"]).map(([m]) => `${m} ${p}`));
    expect(undocumented).toEqual([]);
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const m of Object.keys(ops)) {
        expect(t.app.hasRoute({ method: m.toUpperCase() as "GET", url: p.replace(/\{(\w+)\}/g, ":$1") }), `${m} ${p}`).toBe(true);
      }
    }
  });

  it("marca sesión, parámetros y cuerpos desde los contratos", () => {
    expect(doc.paths["/v1/me"]!.get!.security).toBeDefined();
    expect(doc.paths["/v1/feed"]!.get!.security).toBeUndefined();
    expect(doc.paths["/v1/auth/refresh"]!.post!.security).toBeUndefined();
    expect(doc.paths["/v1/reports"]!.post!.requestBody).toMatchObject({ content: { "application/json": { schema: { type: "object" } } } });
    expect(doc.paths["/v1/events/{id}"]!.get).toBeDefined();
  });
});
