import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

/**
 * Uso sin cuenta: solo lectura (decisión del propietario, ADR 0315 y 0317). Recorre todas las rutas del contrato
 * OpenAPI: sin sesión, ninguna escritura funciona y ninguna lectura personal responde. Una ruta nueva entra sola.
 */
const ID = "00000000-0000-7000-8000-000000000000";
// Escrituras que no actúan como una persona: iniciar sesión, informes de cierre anónimos y webhooks de fuentes con
// su propio secreto. Cualquier otra que aparezca sin sesión hace fallar la prueba.
const PUBLIC_WRITES = new Set([
  "POST /v1/auth/apple", "POST /v1/auth/google", "POST /v1/auth/dev", "POST /v1/auth/email/start", "POST /v1/auth/email/verify",
  "POST /v1/auth/refresh", "POST /v1/auth/logout", "POST /v1/client-crashes", "POST /v1/ingest/{sourceKey}/push",
]);

// Enlace de un solo uso que moderación recibe tras un acceso auditado al original (el token es la credencial).
const CAPABILITY_READS = new Set(["GET /v1/moderation/media-originals/{token}"]);

let t: TestContext;
let ops: { method: string; path: string; url: string; session: boolean }[] = [];
beforeAll(async () => {
  t = await createTestContext();
  const doc = (await t.app.inject({ url: "/v1/openapi.json" })).json() as { paths: Record<string, Record<string, { security?: unknown }>> };
  ops = Object.entries(doc.paths).flatMap(([path, byMethod]) => Object.entries(byMethod).map(([m, op]) => ({
    method: m.toUpperCase(), path, url: path.replace(/\{\w+\}/g, ID), session: op.security !== undefined,
  })));
});
afterAll(async () => { await t.close(); });

describe("uso sin cuenta: solo lectura", () => {
  it("ninguna escritura funciona sin sesión, salvo las que no actúan como una persona", async () => {
    const open: string[] = [];
    for (const o of ops.filter((x) => x.method !== "GET")) {
      if (PUBLIC_WRITES.has(`${o.method} ${o.path}`)) continue;
      const r = await t.app.inject({ method: o.method as "POST", url: o.url, payload: {} });
      if (r.statusCode !== 401) open.push(`${r.statusCode} ${o.method} ${o.path}`);
    }
    expect(ops.length).toBeGreaterThan(100);
    expect(open).toEqual([]);
  });

  it("las lecturas personales piden sesión; las públicas no", async () => {
    const open: string[] = [];
    for (const o of ops.filter((x) => x.method === "GET" && x.session && !CAPABILITY_READS.has(`GET ${x.path}`))) {
      const r = await t.app.inject({ url: o.url });
      if (r.statusCode !== 401) open.push(`${r.statusCode} GET ${o.path}`);
    }
    expect(open).toEqual([]);
    for (const url of ["/v1/events?bbox=-78,-13,-76,-11&zoom=12", "/v1/reference/categories", "/v1/reference/emergency-numbers", "/v1/feed"]) {
      expect((await t.app.inject({ url })).statusCode, url).toBe(200);
    }
  });
});
