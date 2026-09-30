import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher, type IngestionService } from "../src/modules/ingestion/index.js";
import { DomainError } from "../src/platform/errors.js";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

class OnceFetcher implements HttpFetcher {
  constructor(private readonly body: string) {}
  async get(): Promise<FetchResult> { return { status: 200, body: this.body, etag: null }; }
}

describe("ítems externos en ERROR (ADR 0155)", () => {
  it("un ítem que falla queda en ERROR con el motivo, el resto sigue, y se reintenta la próxima vez", async () => {
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
    const body = readFileSync(new URL("./fixtures/usgs-summary.geojson", import.meta.url), "utf8");
    let fail = true;
    // Mismo servicio, pero el primer sismo falla por sí mismo mientras `fail` esté activo.
    const flaky = Object.create(t.c.ingestion) as IngestionService;
    flaky.ingest = async (key, item, lane, rawRef) => {
      if (fail && item.externalId === "us7000pe01") throw new DomainError("INVALID_TARGET", "No se puede declarar sobre ese evento", 409);
      return t.c.ingestion.ingest(key, item, lane, rawRef);
    };
    let now = new Date("2026-09-29T06:00:00Z");
    const scheduler = new IngestionScheduler(t.c.db, flaky, new OnceFetcher(body), { now: () => now });
    const runs = await scheduler.tick();
    expect(runs.find((r) => r.lane === "NORMAL")).toMatchObject({ status: "OK", itemsFailed: 1 });
    const items = async () => (await t.c.db.query<{ external_id: string; status: string; error: string | null }>(
      `SELECT external_id, status, error FROM ingestion.external_items ORDER BY external_id`)).rows;
    expect(await items()).toEqual([
      { external_id: "us7000pe01", status: "ERROR", error: "INVALID_TARGET: No se puede declarar sobre ese evento" },
      { external_id: "us7000pe02", status: "MAPPED", error: null },
    ]);

    fail = false;
    now = new Date("2026-09-30T06:00:00Z");
    await scheduler.tick();
    expect((await items())[0]).toMatchObject({ external_id: "us7000pe01", status: "MAPPED", error: null });
  });
});

describe("compartidos fuera de la app (ADR 0155)", () => {
  it("cuenta una vez por persona, sobre el original, y suma al alcance", async () => {
    const autor = await createUser(t, "ext_autor");
    const [a, b] = await Promise.all(["ext_a", "ext_b"].map((h) => createUser(t, h)));
    const postId = (await submit(t, autor, reportBody(autor, { category: "infra.power_outage", pin: LIMA, text: "Sin luz en la cuadra" }))).body.postId!;
    await t.c.dispatcher.drain();
    const share = (u: TestUser, id: string) => t.app.inject({ method: "POST", url: `/v1/posts/${id}/external-shares`, headers: auth(u) });
    expect((await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/external-shares` })).statusCode).toBe(401);
    expect((await share(a!, "00000000-0000-7000-8000-000000000000")).statusCode).toBe(404);
    expect((await share(a!, postId)).statusCode).toBe(204);
    expect((await share(a!, postId)).statusCode).toBe(204);
    // Compartir fuera un compartido interno cuenta para el original.
    const internal = (await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/share`, headers: auth(b!), payload: {} })).json().postId as string;
    expect((await share(b!, internal)).statusCode).toBe(204);
    const card = async (id: string) => (await t.app.inject({ url: `/v1/posts/${id}` })).json() as { externalShareCount: number };
    expect((await card(postId)).externalShareCount).toBe(2);
    expect((await card(internal)).externalShareCount).toBe(0);
    const target = await t.c.social.moderationTarget(t.c.db, "POST", postId);
    expect(target!.reach).toBeGreaterThanOrEqual(2);
    const exported = await t.c.social.exportData(t.c.db, { userId: a!.userId, profileId: a!.profileId });
    expect(exported["externalShares"]).toHaveLength(1);
  });
});
