import { createHash } from "node:crypto";
import type { CaseDetail, CaseSummary, FeedResponse, MediaView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser, withoutPublishDelay } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function upload(u: TestUser, over: Record<string, unknown> = {}): Promise<string> {
  const file = makeJpeg();
  const res = await t.app.inject({
    method: "POST", url: "/v1/media/uploads", headers: auth(u),
    payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: sha(file), capturedInApp: true, ...over },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { mediaId, upload: up } = res.json();
  const url = new URL(up.url);
  expect((await t.app.inject({ method: "PUT", url: url.pathname + url.search, headers: up.headers, payload: file })).statusCode).toBe(200);
  await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
  await t.c.dispatcher.drain();
  return mediaId as string;
}
const feedMedia = async (postId: string): Promise<MediaView[] | undefined> => {
  const feed = (await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(mod) })).json() as FeedResponse;
  return feed.posts.find((p) => p.id === postId)?.media;
};
const caseFor = async (postId: string) => {
  const q = (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json() as { cases: CaseSummary[] };
  return q.cases.find((c) => c.target.id === postId);
};
const act = (caseId: string, action: string) =>
  t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action, reason: "Revisada la foto: no identifica a nadie" } });

beforeAll(async () => {
  t = await createTestContext();
  await withoutPublishDelay(t, "crime.violence");
  const m = await createUser(t, "mod_media");
  await t.c.identity.grantRole(m.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_media", platform: "ANDROID", deviceId: m.deviceId } })).json().token as string;
  mod = { ...m, token };
});
afterAll(() => t.close());

describe("contenido sensible (ADR 0035)", () => {
  it("quien sube puede marcar la foto como impactante: sale con aviso", async () => {
    const u = await createUser(t, "sube_grafica");
    const id = await upload(u, { graphic: true });
    const [view] = await t.c.media.publicViews(t.c.db, [id], { requireApproval: false });
    expect(view!.contentWarning).toBe("GRAPHIC");
    const plain = await upload(u);
    expect((await t.c.media.publicViews(t.c.db, [plain], { requireApproval: false }))[0]!.contentWarning).toBeNull();
  });

  it("en una categoría sensible la foto espera aprobación en la cola; moderación la aprueba y puede marcarla", async () => {
    const u = await createUser(t, "testigo_robo");
    const mediaId = await upload(u);
    const r = await submit(t, u, { ...reportBody(u, { category: "crime.robbery", pin: offset(LIMA, 4000) }), mediaIds: [mediaId] });
    expect(r.status).toBe(200);
    const postId = r.body.postId!;
    await t.c.dispatcher.drain();
    expect(await feedMedia(postId)).toEqual([]);

    const c = await caseFor(postId);
    expect(c).toBeDefined();
    const detail = (await t.app.inject({ url: `/v1/moderation/cases/${c!.id}`, headers: auth(mod) })).json() as CaseDetail;
    expect(detail.target.media?.map((m) => m.id)).toEqual([mediaId]);
    expect(detail.notes[0]!.reason).toBe("PRIVACY");

    expect((await act(c!.id, "MARK_GRAPHIC")).statusCode).toBe(200);
    const approved = (await act(c!.id, "APPROVE_MEDIA")).json() as CaseDetail;
    expect(approved.status).toBe("RESOLVED");
    const media = await feedMedia(postId);
    expect(media?.map((m) => [m.id, m.contentWarning])).toEqual([[mediaId, "GRAPHIC"]]);
    // Aprobar no es una sanción: no aparece en los avisos de la persona.
    const notices = (await t.app.inject({ url: "/v1/me/moderation", headers: auth(u) })).json() as { notices: { action: { action: string } }[] };
    expect(notices.notices.map((n) => n.action.action)).toEqual(["MARK_GRAPHIC"]);
  });

  it("en categorías muy sensibles toda foto aprobada sale con aviso", async () => {
    const u = await createUser(t, "testigo_violencia");
    const mediaId = await upload(u);
    const r = await submit(t, u, { ...reportBody(u, { category: "crime.violence", pin: offset(LIMA, 8000) }), mediaIds: [mediaId] });
    await t.c.dispatcher.drain();
    const c = await caseFor(r.body.postId!);
    await act(c!.id, "APPROVE_MEDIA");
    expect((await feedMedia(r.body.postId!))?.[0]?.contentWarning).toBe("GRAPHIC");
  });
});
