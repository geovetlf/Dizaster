import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pushSignature } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

const SECRET = "push-secret-de-prueba-0123456789";
const body = readFileSync(new URL("./fixtures/gdacs-rss.xml", import.meta.url), "utf8");
let t: TestContext;

const push = (key: string, payload: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) =>
  t.app.inject({
    method: "POST", url: `/v1/ingest/${key}/push`, payload,
    headers: { "content-type": "application/rss+xml", "x-dizaster-timestamp": String(ts), "x-dizaster-signature": pushSignature(secret, String(ts), payload) },
  });

beforeAll(async () => {
  process.env.SOURCE_PUSH_SECRET_GDACS = SECRET;
  process.env.SOURCE_PUSH_SECRET_USGS_EARTHQUAKES = SECRET;
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("gdacs", "ACTIVE");
  await t.c.db.query(`UPDATE ingestion.sources SET config = config || '{"push": true}'::jsonb WHERE key = 'gdacs'`);
});
afterAll(async () => {
  delete process.env.SOURCE_PUSH_SECRET_GDACS;
  delete process.env.SOURCE_PUSH_SECRET_USGS_EARTHQUAKES;
  await t.close();
});

describe("push firmado de fuentes (ADR 0128)", () => {
  it("un push válido ingiere el documento y queda como corrida PUSH", async () => {
    const res = await push("gdacs", body);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ itemsSeen: 2, itemsNew: 2 });
    const run = (await t.c.db.query(`SELECT r.trigger, r.lane, r.status FROM ingestion.runs r JOIN ingestion.sources s ON s.id = r.source_id WHERE s.key = 'gdacs'`)).rows;
    expect(run).toEqual([{ trigger: "PUSH", lane: "URGENT", status: "OK" }]);
  });

  it("repetir el mismo documento es idempotente", async () => {
    const res = await push("gdacs", body);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ itemsSeen: 2, itemsNew: 0 });
  });

  it("rechaza firma inválida, cuerpo alterado y marca de tiempo vieja", async () => {
    expect((await push("gdacs", body, undefined, "otro-secreto")).statusCode).toBe(401);
    const ts = Math.floor(Date.now() / 1000);
    const tampered = await t.app.inject({
      method: "POST", url: "/v1/ingest/gdacs/push", payload: body + " ",
      headers: { "content-type": "text/xml", "x-dizaster-timestamp": String(ts), "x-dizaster-signature": pushSignature(SECRET, String(ts), body) },
    });
    expect(tampered.statusCode).toBe(401);
    expect((await push("gdacs", body, ts - 3600)).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/ingest/gdacs/push", payload: body, headers: { "content-type": "text/xml" } })).statusCode).toBe(401);
  });

  it("fuente desconocida o sin push habilitado responde 404 igual", async () => {
    expect((await push("no-existe", body)).statusCode).toBe(404);
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
    expect((await push("usgs-earthquakes", body)).statusCode).toBe(404);
    await t.c.db.query(`UPDATE ingestion.sources SET config = config - 'push' WHERE key = 'gdacs'`);
    expect((await push("gdacs", body)).statusCode).toBe(404);
    await t.c.db.query(`UPDATE ingestion.sources SET config = config || '{"push": true}'::jsonb WHERE key = 'gdacs'`);
  });

  it("un documento que el adapter no puede interpretar queda como corrida FAILED (422)", async () => {
    await t.c.db.query(`UPDATE ingestion.sources SET config = config || '{"push": true}'::jsonb WHERE key = 'usgs-earthquakes'`);
    expect((await push("usgs-earthquakes", "{no es json")).statusCode).toBe(422);
    const run = (await t.c.db.query(`SELECT r.status FROM ingestion.runs r JOIN ingestion.sources s ON s.id = r.source_id WHERE s.key = 'usgs-earthquakes'`)).rows;
    expect(run).toEqual([{ status: "FAILED" }]);
  });
});
