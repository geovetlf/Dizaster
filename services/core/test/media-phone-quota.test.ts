import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmAge, createTestContext, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

// Cupo de subidas por teléfono (ADR 0207): varias cuentas en el mismo teléfono comparten el cupo (en pruebas, 6/h).
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

async function userOn(handle: string, hardwareId: string): Promise<TestUser> {
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", hardwareId } });
  expect(res.statusCode, res.body).toBe(200);
  const u = res.json() as TestUser;
  await confirmAge(t, u);
  return u;
}
const file = makeJpeg();
const upload = (u: TestUser) => t.app.inject({
  method: "POST", url: "/v1/media/uploads", headers: { authorization: `Bearer ${u.token}` },
  payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update(file).digest("hex"), width: 1920, height: 1080, capturedInApp: true },
});

describe("cupo de subidas por teléfono", () => {
  it("dos cuentas en el mismo teléfono comparten el cupo; otro teléfono no se ve afectado", async () => {
    const a = await userOn("sube_tel_a", "hw-telefono-compartido-000000000001");
    const b = await userOn("sube_tel_b", "hw-telefono-compartido-000000000001");
    const other = await userOn("sube_tel_c", "hw-otro-telefono-000000000000000002");
    for (let i = 0; i < 4; i++) expect((await upload(a)).statusCode).toBe(201);
    for (let i = 0; i < 2; i++) expect((await upload(b)).statusCode).toBe(201);
    const blocked = await upload(b);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("RATE_LIMITED");
    expect((await upload(other)).statusCode).toBe(201);
  });

  it("el teléfono se olvida a los 2 días", async () => {
    await t.c.db.query(`UPDATE media.media SET created_at = now() - interval '3 days' WHERE phone_id IS NOT NULL`);
    await t.c.media.applyRetention();
    const { rows } = await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM media.media WHERE phone_id IS NOT NULL`);
    expect(rows[0]!.n).toBe(0);
  });
});
