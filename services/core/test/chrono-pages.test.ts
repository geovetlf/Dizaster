import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Timeline y comentarios por páginas con cursor (ADR 0106).
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

type Page = { nextCursor: string | null };
async function all<T extends { id: string }>(url: (cursor: string | null) => string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await t.app.inject({ url: url(cursor) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Page & Record<string, T[]>;
    out.push(...body[key]!);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return out;
}

describe("páginas cronológicas", () => {
  it("la timeline se recorre entera en ambos sentidos, sin perder empates de hora", async () => {
    const ana = await createUser(t, "ana_pages");
    const r = await submit(t, ana, reportBody(ana, { category: "infra.road_blocked", pin: offset(LIMA, 900) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const eventId = r.body.eventId!;
    // Cinco entradas con la misma hora exacta y una interna que nunca sale.
    const at = new Date(Date.now() + 60_000);
    for (let i = 0; i < 5; i++) {
      await t.c.db.query(`INSERT INTO event.timeline (id, event_id, type, at) VALUES ($1, $2, 'STATUS_CHANGED', $3)`, [randomUUID(), eventId, at]);
    }
    await t.c.db.query(`INSERT INTO event.timeline (id, event_id, type, visibility) VALUES ($1, $2, 'NOTE', 'INTERNAL')`, [randomUUID(), eventId]);
    const full = (await t.app.inject({ url: `/v1/events/${eventId}/timeline` })).json() as { entries: { id: string }[]; nextCursor: string | null };
    expect(full.nextCursor).toBeNull();
    const asc = await all<{ id: string }>((c) => `/v1/events/${eventId}/timeline?limit=2${c ? `&cursor=${c}` : ""}`, "entries");
    expect(asc.map((e) => e.id)).toEqual(full.entries.map((e) => e.id));
    const desc = await all<{ id: string }>((c) => `/v1/events/${eventId}/timeline?limit=2&order=desc${c ? `&cursor=${c}` : ""}`, "entries");
    expect(desc.map((e) => e.id)).toEqual(full.entries.map((e) => e.id).reverse());
    // Un cursor ajeno al evento o mal formado es un error de validación.
    expect((await t.app.inject({ url: `/v1/events/${eventId}/timeline?cursor=${randomUUID()}` })).statusCode).toBe(400);
    expect((await t.app.inject({ url: `/v1/events/${eventId}/timeline?cursor=nope` })).statusCode).toBe(400);
    expect((await t.app.inject({ url: `/v1/events/${eventId}/timeline?limit=500` })).statusCode).toBe(400);
  });

  it("los comentarios se paginan sin repetir ni saltar, y publicar uno devuelve ese comentario", async () => {
    const [ana, bea] = await Promise.all([createUser(t, "ana_cpages"), createUser(t, "bea_cpages")]);
    const r = await submit(t, ana, reportBody(ana, { category: "infra.road_blocked", pin: offset(LIMA, 2500) }));
    const postId = r.body.postId!;
    const at = new Date();
    for (let i = 0; i < 7; i++) {
      await t.c.db.query(`INSERT INTO social.comments (id, post_id, author_profile_id, text, created_at) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), postId, bea.profileId, `c${i}`, at]);
    }
    const posted = await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: { authorization: `Bearer ${bea.token}` }, payload: { text: "último" } });
    expect(posted.statusCode).toBe(201);
    expect(posted.json()).toMatchObject({ text: "último", mine: true });

    const pages = await all<{ id: string; text: string }>((c) => `/v1/posts/${postId}/comments?limit=3${c ? `&cursor=${c}` : ""}`, "comments");
    expect(pages).toHaveLength(8);
    expect(new Set(pages.map((c) => c.id)).size).toBe(8);
    expect(pages.at(-1)!.text).toBe("último");
    const newest = (await t.app.inject({ url: `/v1/posts/${postId}/comments?order=desc&limit=1` })).json() as { comments: { text: string }[]; nextCursor: string };
    expect(newest.comments[0]!.text).toBe("último");
    expect(newest.nextCursor).toBeTruthy();
    expect((await t.app.inject({ url: `/v1/posts/${postId}/comments?cursor=${randomUUID()}` })).statusCode).toBe(400);
  });
});
