import type { CaseDetail, FeedPost } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let ana: TestUser;
let beto: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const create = async (u: TestUser, text: string) => (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text } })).json().postId as string;
const edit = (u: TestUser, id: string, text: string) => t.app.inject({ method: "PATCH", url: `/v1/posts/${id}`, headers: auth(u), payload: { text } });
const view = async (u: TestUser, id: string) => (await t.app.inject({ url: `/v1/posts/${id}`, headers: auth(u) })).json() as FeedPost;

beforeAll(async () => {
  t = await createTestContext();
  ana = await createUser(t, "ana_edita");
  beto = await createUser(t, "beto_edita");
});
afterAll(() => t.close());

describe("editar posts (ADR 0136)", () => {
  it("quien lo escribió lo edita durante 24 h; se marca editado y se reindexa", async () => {
    const id = await create(ana, "Corte de agua en #miraflores");
    expect((await view(ana, id)).editableUntil).toBeTruthy();
    expect((await view(beto, id)).editableUntil).toBeNull();
    const handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [beto.profileId])).rows[0]!.handle;
    const r = await edit(ana, id, `Corte de agua en #surco, avisa @${handle}`);
    expect(r.statusCode).toBe(200);
    const p = await view(beto, id);
    expect(p).toMatchObject({ text: `Corte de agua en #surco, avisa @${handle}`, mentions: [handle] });
    expect(p.editedAt).toBeTruthy();
    const tags = (await t.c.db.query<{ normalized: string }>(`SELECT t.normalized FROM social.post_tags pt JOIN social.tags t ON t.id = pt.tag_id WHERE pt.post_id = $1`, [id])).rows;
    expect(tags.map((x) => x.normalized)).toEqual(["surco"]);
    // Mismo texto: no crea otra versión.
    await edit(ana, id, `Corte de agua en #surco, avisa @${handle}`);
    expect((await t.c.db.query(`SELECT 1 FROM social.post_edits WHERE post_id = $1`, [id])).rowCount).toBe(1);
  });

  it("nadie más lo edita; fuera de plazo, reportes y posts ocultos no se editan", async () => {
    const id = await create(ana, "Texto original");
    expect((await edit(beto, id, "Ajeno")).statusCode).toBe(404);
    await t.c.db.query(`UPDATE social.posts SET created_at = now() - interval '25 hours' WHERE id = $1`, [id]);
    expect((await edit(ana, id, "Tarde")).json()).toMatchObject({ error: "EDIT_WINDOW_CLOSED" });
    expect((await view(ana, id)).editableUntil).toBeNull();

    const rep = await submit(t, ana, reportBody(ana, { pin: LIMA, text: "Choque en la avenida" }));
    expect((await edit(ana, rep.body.postId!, "Otro texto")).json()).toMatchObject({ error: "POST_NOT_EDITABLE" });

    const hidden = await create(ana, "Para ocultar");
    await t.c.db.query(`UPDATE social.posts SET moderation_state = 'HIDDEN' WHERE id = $1`, [hidden]);
    expect((await edit(ana, hidden, "Cambio")).statusCode).toBe(409);
    expect((await edit(ana, id, "")).statusCode).toBe(400);
  });

  it("el historial solo lo ve moderación, en el caso", async () => {
    const id = await create(ana, "Versión uno");
    await edit(ana, id, "Versión dos");
    expect(JSON.stringify(await view(beto, id))).not.toContain("Versión uno");
    const mod = await createUser(t, "mod_edita");
    await t.c.identity.grantRole(mod.userId, "moderator");
    const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_edita", platform: "ANDROID", deviceId: mod.deviceId } })).json().token as string;
    await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(beto), payload: { targetType: "POST", targetId: id, reason: "FALSE_INFO" } });
    const caseId = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.cases WHERE target_id = $1`, [id])).rows[0]!.id;
    const detail = (await t.app.inject({ url: `/v1/moderation/cases/${caseId}`, headers: { authorization: `Bearer ${token}` } })).json() as CaseDetail;
    expect(detail.edits).toMatchObject([{ previousText: "Versión uno" }]);
  });
});
