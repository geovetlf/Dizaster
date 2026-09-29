import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Cuota diaria de datos subidos según reputación (ADR 0072). NO AI REQUIRED: una suma en PostgreSQL.
let t: TestContext;
beforeAll(async () => { t = await createTestContext({ env: { MEDIA_DAILY_UPLOAD_MB: "60", MEDIA_UPLOADS_PER_HOUR_LIMIT: "100" } }); });
afterAll(async () => { await t.close(); });

const MB = 1024 * 1024;
let n = 0;
async function ask(u: TestUser, sizeBytes = 8 * MB) {
  const sha256 = createHash("sha256").update(`quota-${n++}`).digest("hex");
  return t.app.inject({
    method: "POST", url: "/v1/media/uploads", headers: { authorization: `Bearer ${u.token}` },
    payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes, sha256, width: 1920, height: 1080, capturedInApp: true },
  });
}
async function fill(u: TestUser, times: number) {
  for (let i = 0; i < times; i++) expect((await ask(u)).statusCode).toBe(201);
}

describe("cuota diaria de datos subidos", () => {
  it("una cuenta nueva tiene la mitad de la base", async () => {
    const u = await createUser(t, "quota_new", 2);
    await fill(u, 3); // 24 MB de 30
    const res = await ask(u);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("DAILY_UPLOAD_QUOTA");
    expect((await ask(u, 6 * MB)).statusCode).toBe(201); // 30 MB justos sí caben
  });

  it("una cuenta con antigüedad tiene la base completa", async () => {
    const u = await createUser(t, "quota_std", 72);
    await fill(u, 7); // 56 MB de 60
    expect((await ask(u)).statusCode).toBe(429);
  });

  it("lo rechazado o de hace más de 24 h no cuenta", async () => {
    const u = await createUser(t, "quota_reset", 72);
    await fill(u, 7);
    expect((await ask(u)).statusCode).toBe(429);
    await t.c.db.query(
      `UPDATE media.media SET state = 'REJECTED', rejection_reason = 'test' WHERE id = (SELECT id FROM media.media WHERE owner_profile_id = $1 LIMIT 1)`, [u.profileId],
    );
    expect((await ask(u)).statusCode).toBe(201);
    await t.c.db.query(`UPDATE media.media SET created_at = now() - interval '25 hours' WHERE owner_profile_id = $1`, [u.profileId]);
    await fill(u, 7);
  });

});
