import { createHash } from "node:crypto";
import type { CaseSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

// Lista de hashes de contenido retirado (ADR 0145): coincidir oculta y manda a moderación; nunca rechaza. NO AI REQUIRED.
let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function asRole(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
async function uploadReady(u: TestUser, file: Buffer): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/v1/media/uploads", headers: auth(u),
    payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: sha(file), width: 1920, height: 1080, capturedInApp: true } });
  const { mediaId, upload } = res.json();
  const url = new URL(upload.url);
  await t.app.inject({ method: "PUT", url: url.pathname + url.search, headers: upload.headers, payload: file });
  await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
  await t.c.dispatcher.drain();
  return mediaId as string;
}
async function post(u: TestUser, text: string, mediaId: string): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text, mediaIds: [mediaId] } });
  expect(res.statusCode).toBe(201);
  await t.c.dispatcher.drain();
  return res.json().postId as string;
}
const caseFor = async (postId: string) =>
  ((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases as CaseSummary[]).find((c) => c.target.id === postId);
async function act(postId: string, action: string, flagger: TestUser) {
  if (!(await caseFor(postId))) await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: postId, reason: "OTHER", note: "revisar" } });
  const c = (await caseFor(postId))!;
  const res = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${c.id}/actions`, headers: auth(mod), payload: { action, reason: "Decisión de moderación de prueba" } });
  expect(res.statusCode).toBe(200);
  await t.c.dispatcher.drain();
}
const mediaState = async (id: string) => (await t.c.db.query<{ moderation_state: string }>(`SELECT moderation_state FROM media.media WHERE id = $1`, [id])).rows[0]!.moderation_state;
const shownMedia = async (postId: string) => ((await t.app.inject({ url: `/v1/posts/${postId}` })).json().media as unknown[] | undefined)?.length ?? 0;

beforeAll(async () => {
  t = await createTestContext();
  mod = await asRole("moderadora_hash");
});
afterAll(() => t.close());

describe("lista de hashes de contenido retirado", () => {
  it("una copia de lo retirado queda oculta y en la cola; aprobarla la muestra; restaurar saca el hash", async () => {
    const [a, b, f] = await Promise.all([createUser(t, "hash_a"), createUser(t, "hash_b"), createUser(t, "hash_f")]);
    const file = makeJpeg();
    const original = await post(a, "Foto que se retirará", await uploadReady(a, file));
    await act(original, "REMOVE", f);
    expect((await t.c.db.query(`SELECT 1 FROM media.blocked_hashes`)).rowCount).toBe(1);

    const copy = await uploadReady(b, file);
    expect(await mediaState(copy)).toBe("HELD");
    expect((await t.app.inject({ url: `/v1/media/${copy}`, headers: auth(b) })).json().state).toBe("READY"); // no se rechaza
    const reposted = await post(b, "La misma foto otra vez", copy);
    expect(await caseFor(reposted)).toBeDefined();
    expect(await shownMedia(reposted)).toBe(0);

    await act(reposted, "APPROVE_MEDIA", f);
    expect(await mediaState(copy)).toBe("APPROVED");
    expect(await shownMedia(reposted)).toBe(1);

    await act(original, "RESTORE", f);
    expect((await t.c.db.query(`SELECT 1 FROM media.blocked_hashes`)).rowCount).toBe(0);
    const again = await uploadReady(b, file);
    expect(await mediaState(again)).toBe("PENDING");
  });
});
