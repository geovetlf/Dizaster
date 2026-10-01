import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids.js";
import { LIMA, createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/** Registros de accesos de administración paginados y con alias (ADR 0299). NO AI REQUIRED. */
let t: TestContext;
let reporter: TestUser;
let moderator: TestUser;
let admin: TestUser;
let reportId: string;
beforeAll(async () => {
  t = await createTestContext();
  reporter = await createUser(t, "logs_autor");
  const r = await submit(t, reporter, reportBody(reporter, { pin: LIMA }));
  reportId = (await t.c.db.query<{ id: string }>(`SELECT id FROM report.reports WHERE post_id = $1`, [r.body.postId])).rows[0]!.id;
  const withRole = async (h: string, role: "admin" | "moderator") => {
    const u = await createUser(t, h);
    await t.c.identity.grantRole(u.userId, role);
    return { ...u, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: h, platform: "ANDROID", deviceId: u.deviceId } })).json().token };
  };
  moderator = await withRole("logs_mod", "moderator");
  admin = await withRole("logs_admin", "admin");
});
afterAll(async () => { await t.close(); });

const get = (u: TestUser, url: string) => t.app.inject({ url, headers: { authorization: `Bearer ${u.token}` } });

/** Recorre todas las páginas y devuelve los ids en orden. */
async function walk(base: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const sep = base.includes("?") ? "&" : "?";
    const res = await get(admin, `${base}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { entries: { id: string }[]; nextCursor: string | null };
    ids.push(...body.entries.map((e) => e.id));
    cursor = body.nextCursor;
  } while (cursor);
  return ids;
}

describe("registro de accesos a presencia", () => {
  it("pagina sin repetir, filtra y muestra el alias de quien consultó", async () => {
    await t.c.db.query(
      `INSERT INTO report.presence_access_log (id, report_id, actor_user_id, reason, precise_shown, accessed_at)
       SELECT gen_random_uuid(), $1, $2, 'revisión de prueba ' || g, false, now() - make_interval(mins => g) FROM generate_series(1, 5) g`,
      [reportId, moderator.userId],
    );
    const all = (await get(admin, "/v1/admin/presence-access")).json();
    expect(all.entries).toHaveLength(5);
    expect(all.nextCursor).toBeNull();
    expect(all.entries[0]).toMatchObject({ actorHandle: expect.stringMatching(/^logs_mod/), reason: "revisión de prueba 1" });

    const paged = await walk("/v1/admin/presence-access", 2);
    expect(paged).toEqual(all.entries.map((e: { id: string }) => e.id));

    expect((await get(admin, `/v1/admin/presence-access?actorUserId=${admin.userId}`)).json().entries).toHaveLength(0);
    expect((await get(admin, `/v1/admin/presence-access?reportId=${reportId}`)).json().entries).toHaveLength(5);
    expect((await get(admin, `/v1/admin/presence-access?cursor=${randomUUID()}`)).statusCode).toBe(400);
    expect((await get(moderator, "/v1/admin/presence-access")).statusCode).toBe(403);
  });
});

describe("registro de originales vistos por moderación", () => {
  it("solo administración; filtros, cursor y alias", async () => {
    const mediaA = randomUUID();
    const mediaB = randomUUID();
    for (const [i, media] of [mediaA, mediaA, mediaB].entries()) {
      await t.c.db.query(
        `INSERT INTO media.original_access_log (id, media_id, actor_user_id, reason, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, now())`,
        [newId(), media, moderator.userId, `revisión del original ${i}`, `hash-de-prueba-${i}-${randomUUID()}`],
      );
      await new Promise((r) => setTimeout(r, 3)); // ids v7 en milisegundos distintos: el orden es el de inserción
    }
    expect((await get(moderator, "/v1/admin/media-original-access")).statusCode).toBe(403);
    const res = await get(admin, "/v1/admin/media-original-access");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const all = res.json();
    expect(all.entries).toHaveLength(3);
    expect(all.entries[0]).toMatchObject({ mediaId: mediaB, actorHandle: expect.stringMatching(/^logs_mod/), reason: "revisión del original 2" });
    expect(JSON.stringify(all)).not.toContain("hash-de-prueba");

    expect(await walk("/v1/admin/media-original-access", 1)).toEqual(all.entries.map((e: { id: string }) => e.id));
    expect((await get(admin, `/v1/admin/media-original-access?mediaId=${mediaA}`)).json().entries).toHaveLength(2);
    expect((await get(admin, `/v1/admin/media-original-access?actorUserId=${admin.userId}`)).json().entries).toHaveLength(0);
  });
});
