import type { CommentView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTO_LIMIT_FLAGGERS } from "../src/modules/moderation/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Comentarios denunciados por AUTO_LIMIT_FLAGGERS personas establecidas se ocultan hasta revisión (ADR 0146).
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("ocultar comentarios muy denunciados", () => {
  it("se oculta al llegar al umbral de personas establecidas; las cuentas nuevas no cuentan", async () => {
    const autor = await createUser(t, "com_autor");
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autor), payload: { text: "Post con comentarios" } })).json().postId as string;
    const commentId = (await t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(autor), payload: { text: "Comentario denunciado" } })).json().id as string;
    const visible = async () => ((await t.app.inject({ url: `/v1/posts/${post}/comments` })).json().comments as CommentView[]).some((c) => c.id === commentId);
    const flag = (u: TestUser) => t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(u), payload: { targetType: "COMMENT", targetId: commentId, reason: "HARASSMENT" } });

    const nuevas = await Promise.all(Array.from({ length: AUTO_LIMIT_FLAGGERS }, (_, i) => createUser(t, `com_nueva${i}`, 1)));
    for (const u of nuevas) await flag(u);
    expect(await visible()).toBe(true);

    const establecidas = await Promise.all(Array.from({ length: AUTO_LIMIT_FLAGGERS }, (_, i) => createUser(t, `com_vecina${i}`)));
    for (const u of establecidas.slice(0, -1)) await flag(u);
    expect(await visible()).toBe(true);
    await flag(establecidas[establecidas.length - 1]!);
    expect(await visible()).toBe(false);
    const actions = (await t.c.db.query<{ action: string; actor: string }>(`SELECT action, actor FROM moderation.actions WHERE target_id = $1`, [commentId])).rows;
    expect(actions).toEqual([{ action: "HIDE", actor: "RULE" }]);
  });
});
