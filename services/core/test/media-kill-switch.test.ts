import { createHash } from "node:crypto";
import { mediaAvailability } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Kill switches de video y subidas (ADR 0082). NO AI REQUIRED.
let t: TestContext;
let admin: string;
let u: TestUser;
let n = 0;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await createTestContext();
  const a = await createUser(t, "operador_media");
  await t.c.identity.grantRole(a.userId, "admin");
  admin = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "operador_media", platform: "ANDROID", deviceId: a.deviceId } })).json().token;
  u = await createUser(t, "sube_media");
});
afterAll(async () => { await t.close(); });

const upload = (kind: "IMAGE" | "VIDEO_RECORDED") => t.app.inject({
  method: "POST", url: "/v1/media/uploads", headers: auth(u.token),
  payload: kind === "IMAGE"
    ? { kind, mime: "image/jpeg", sizeBytes: 1000, sha256: createHash("sha256").update(`k${n++}`).digest("hex"), width: 10, height: 10, capturedInApp: true }
    : { kind, mime: "video/mp4", sizeBytes: 1000, sha256: createHash("sha256").update(`k${n++}`).digest("hex"), width: 10, height: 10, durationMs: 5000, capturedInApp: true },
});
const kill = async (feature: string, killed: boolean) => {
  const res = await t.app.inject({ method: "PUT", url: `/v1/admin/kill-switches/${feature}`, headers: auth(admin), payload: { killed, reason: "Prueba" } });
  expect(res.statusCode).toBe(200);
  // El estado se cachea 15 s en el proceso: se lee de nuevo en la prueba.
  (t.c.cost as unknown as { kills: unknown }).kills = null;
};
const config = async () => (await t.app.inject({ url: "/v1/config" })).json().killSwitches as Record<string, boolean>;

describe("kill switches de media", () => {
  it("aparecen en el tablero aunque nunca se hayan tocado", async () => {
    const d = (await t.app.inject({ url: "/v1/admin/cost", headers: auth(admin) })).json();
    expect(d.killSwitches.map((k: { feature: string }) => k.feature)).toEqual(expect.arrayContaining(["media-upload", "video"]));
  });

  it("apagar video corta solo los videos; apagar subidas corta todo; al volver, funciona", async () => {
    await kill("video", true);
    expect((await upload("VIDEO_RECORDED")).json()).toMatchObject({ error: "FEATURE_DISABLED" });
    expect((await upload("IMAGE")).statusCode).toBe(201);
    expect(mediaAvailability(await config())).toEqual({ photo: true, video: false });

    await kill("media-upload", true);
    const res = await upload("IMAGE");
    expect(res.statusCode).toBe(503);
    expect(mediaAvailability(await config())).toEqual({ photo: false, video: false });

    await kill("media-upload", false);
    await kill("video", false);
    expect((await upload("VIDEO_RECORDED")).statusCode).toBe(201);
    expect(mediaAvailability(await config())).toEqual({ photo: true, video: true });
  });

  it("sin datos de configuración, todo disponible", () => {
    expect(mediaAvailability(undefined)).toEqual({ photo: true, video: true });
  });
});
