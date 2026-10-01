import type { DuplicateCandidateView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTO_MERGE, mergeOrder } from "../src/modules/event/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Fusión automática de duplicados y cola de posibles duplicados (ADR 0076). NO AI REQUIRED.
let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  t = await createTestContext();
  const u = await createUser(t, "mod_dup");
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_dup", platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  mod = { ...u, token };
});
afterAll(() => t.close());

/** Dos eventos creados lejos (no se unieron al reportar) y luego el segundo se "corre" junto al primero. */
async function pair(handle: string, base: { lat: number; lng: number }, gapM: number, text?: string) {
  const [u1, u2] = await Promise.all([createUser(t, `${handle}_1`), createUser(t, `${handle}_2`)]);
  const a = (await submit(t, u1!, reportBody(u1!, { category: "fire.structure", pin: base, ...(text ? { text } : {}) }))).body.eventId!;
  const b = (await submit(t, u2!, reportBody(u2!, { category: "fire.structure", pin: offset(base, 5_000), ...(text ? { text } : {}) }))).body.eventId!;
  expect(b).not.toBe(a);
  const p = offset(base, gapM);
  await t.c.db.query(`UPDATE event.events SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography WHERE id = $1`, [b, p.lng, p.lat]);
  await t.c.dispatcher.drain();
  return { a, b };
}
const sweep = () => t.c.events.sweepDuplicates(t.c.db, new Date());
const queue = async () => (await t.app.inject({ url: "/v1/moderation/duplicates", headers: auth(mod) })).json().candidates as DuplicateCandidateView[];

describe("fusión automática de duplicados", () => {
  it("un duplicado claro se fusiona solo en el más antiguo, queda en el registro y se puede revertir sin que vuelva a fusionarse", async () => {
    const { a, b } = await pair("auto", offset(LIMA, 0, 150_000), 20, "Incendio en el edificio de la avenida principal");
    expect(await sweep()).toMatchObject({ merged: 1 });
    const log = (await t.c.db.query<{ id: string; target_event_id: string; merged_event_id: string; actor: string; score: number }>(
      `SELECT id, target_event_id, merged_event_id, actor, score FROM event.merge_log WHERE merged_event_id = $1`, [b],
    )).rows[0]!;
    expect(log).toMatchObject({ target_event_id: a, actor: AUTO_MERGE.actor });
    expect(log.score).toBeGreaterThanOrEqual(0.8);
    expect((await t.app.inject({ url: `/v1/events/${b}` })).json().mergedIntoId).toBe(a);

    const revert = await t.app.inject({ method: "POST", url: `/v1/moderation/merges/${log.id}/revert`, headers: auth(mod), payload: { reason: "Son dos edificios distintos" } });
    expect(revert.statusCode).toBe(200);
    expect(await sweep()).toMatchObject({ merged: 0 });
    expect((await t.app.inject({ url: `/v1/events/${b}` })).json().mergedIntoId).toBeNull();

    const stats = await t.c.events.qualityStats(t.c.db, new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(stats).toMatchObject({ autoMerged: 1, autoMergeReverted: 1 });
  });

  it("en la franja ambigua el par va a la cola; descartado, no vuelve", async () => {
    const { a, b } = await pair("ambig", offset(LIMA, 0, 170_000), 200);
    expect(await sweep()).toMatchObject({ merged: 0, queued: 1 });
    const q = await queue();
    const item = q.find((c) => c.events.some((e) => e.id === a))!;
    expect(item).toMatchObject({ reason: "AMBIGUOUS_SCORE" });
    expect(item.events.map((e) => e.id).sort()).toEqual([a, b].sort());
    expect(item.score).toBeGreaterThanOrEqual(0.55);
    expect(item.score).toBeLessThan(0.8);

    const anon = await createUser(t, "curioso_dup");
    expect((await t.app.inject({ url: "/v1/moderation/duplicates", headers: auth(anon) })).statusCode).toBe(403);
    const res = await t.app.inject({ method: "POST", url: `/v1/moderation/duplicates/${item.id}/dismiss`, headers: auth(mod), payload: { reason: "Dos focos distintos" } });
    expect(res.statusCode).toBe(204);
    expect((await queue()).some((c) => c.id === item.id)).toBe(false);
    expect(await sweep()).toMatchObject({ merged: 0, queued: 0 });
  });

  it("si ambos tienen fuentes externas u oficiales, decide una persona; fusionar desde la cola la cierra", async () => {
    const { a, b } = await pair("fuentes", offset(LIMA, 0, 190_000), 20, "Incendio en el mercado mayorista de la ciudad");
    await t.c.db.query(`UPDATE event.evidence SET trust_tier = 'EXTERNAL' WHERE event_id = ANY($1)`, [[a, b]]);
    expect(await sweep()).toMatchObject({ merged: 0, queued: 1 });
    const item = (await queue()).find((c) => c.events.some((e) => e.id === a))!;
    expect(item.reason).toBe("BOTH_SOURCED");
    const merge = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${a}/merge`, headers: auth(mod), payload: { sourceEventIds: [b], reason: "Mismo incendio en dos fuentes" } });
    expect(merge.statusCode).toBe(200);
    const row = (await t.c.db.query<{ status: string }>(`SELECT status FROM event.duplicate_candidates WHERE id = $1`, [item.id])).rows[0]!;
    expect(row.status).toBe("MERGED");
  });

  it("el destino es el de mayor verificación, luego con fuentes, luego el más antiguo", () => {
    const e = (id: string, level: "UNVERIFIED" | "OFFICIALLY_CONFIRMED", sourced: boolean, t0: number) => ({ id, verification_level: level, sourced, first_seen_at: new Date(t0) });
    expect(mergeOrder(e("x", "UNVERIFIED", false, 1), e("y", "OFFICIALLY_CONFIRMED", true, 2))[0].id).toBe("y");
    expect(mergeOrder(e("x", "UNVERIFIED", false, 1), e("y", "UNVERIFIED", true, 2))[0].id).toBe("y");
    expect(mergeOrder(e("x", "UNVERIFIED", false, 1), e("y", "UNVERIFIED", false, 2))[0].id).toBe("x");
  });
});

describe("cola de duplicados por páginas (ADR 0298)", () => {
  it("recorre la cola con cursor, informa el total y rechaza un cursor desconocido", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = await createUser(t, `pag_dup_${i}`);
      ids.push((await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(LIMA, -40_000 - i * 10_000, 90_000) }))).body.eventId!);
    }
    for (const other of ids.slice(1)) {
      const [x, y] = [ids[0]!, other].sort();
      await t.c.db.query(`INSERT INTO event.duplicate_candidates (id, event_a, event_b, score, reason) VALUES (gen_random_uuid(), $1, $2, 0.6, 'AMBIGUOUS_SCORE')`, [x, y]);
    }
    const all = (await t.app.inject({ url: "/v1/moderation/duplicates?limit=200", headers: auth(mod) })).json() as { candidates: DuplicateCandidateView[]; total: number };
    expect(all.total).toBe(all.candidates.length);
    expect(all.total).toBeGreaterThanOrEqual(3);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await t.app.inject({ url: `/v1/moderation/duplicates?limit=2${cursor ? `&cursor=${cursor}` : ""}`, headers: auth(mod) })).json() as { candidates: DuplicateCandidateView[]; nextCursor: string | null; total: number };
      expect(page.candidates.length).toBeLessThanOrEqual(2);
      expect(page.total).toBe(all.total);
      seen.push(...page.candidates.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.candidates.map((c) => c.id));
    const bad = await t.app.inject({ url: "/v1/moderation/duplicates?cursor=00000000-0000-4000-8000-000000000000", headers: auth(mod) });
    expect(bad.statusCode).toBe(400);
  });
});
