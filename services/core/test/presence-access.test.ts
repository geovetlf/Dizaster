import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRESENCE_ACCESS_PER_HOUR } from "../src/modules/report/index.js";
import { LIMA, createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Acceso auditado a la evidencia de presencia (ADR 0089, Blueprint §7.3, §13.1). NO AI REQUIRED.
let t: TestContext;
let reporter: TestUser;
let moderator: TestUser;
let admin: TestUser;
let postId: string;
beforeAll(async () => {
  t = await createTestContext();
  reporter = await createUser(t, "pres_autor");
  const r = await submit(t, reporter, reportBody(reporter, { pin: LIMA }));
  postId = r.body.postId!;
  const withRole = async (h: string, role: "admin" | "moderator") => {
    const u = await createUser(t, h);
    await t.c.identity.grantRole(u.userId, role);
    return { ...u, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: h, platform: "ANDROID", deviceId: u.deviceId } })).json().token };
  };
  moderator = await withRole("pres_mod", "moderator");
  admin = await withRole("pres_admin", "admin");
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const review = (u: TestUser, payload: object, id = postId) =>
  t.app.inject({ method: "POST", url: `/v1/moderation/posts/${id}/presence`, headers: auth(u), payload });

describe("evidencia de presencia", () => {
  it("solo moderación, con motivo; devuelve la ubicación precisa y deja rastro", async () => {
    expect((await review(reporter, { reason: "Quiero ver dónde estaba" })).statusCode).toBe(403);
    expect((await review(moderator, { reason: "corto" })).statusCode).toBe(400);
    const res = await review(moderator, { reason: "Caso de posible ubicación falsa" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const v = res.json();
    expect(v.deviceFix.lat).toBeCloseTo(LIMA.lat, 2);
    expect(v).toMatchObject({ priorAccesses: 0, generalizedAt: null, attestationVerdict: expect.any(String) });
    expect((await review(moderator, { reason: "Segunda revisión del mismo caso" })).json().priorAccesses).toBe(1);

    const log = (await t.app.inject({ url: "/v1/admin/presence-access", headers: auth(admin) })).json().entries;
    expect(log[0]).toMatchObject({ actorUserId: moderator.userId, reason: "Segunda revisión del mismo caso", preciseShown: true });
    expect((await t.app.inject({ url: "/v1/admin/presence-access", headers: auth(moderator) })).statusCode).toBe(403);
    await expect(t.c.db.query(`DELETE FROM report.presence_access_log`)).rejects.toThrow(/solo de inserción/);
  });

  it("tras generalizarse ya no hay ubicación precisa, y el acceso lo registra", async () => {
    await t.c.db.query(`UPDATE report.presence_evidence SET device_fix = NULL, device_fix_enc = NULL, generalized_at = now()
      WHERE report_id = (SELECT id FROM report.reports WHERE post_id = $1)`, [postId]);
    const v = (await review(moderator, { reason: "Revisión después de la retención" })).json();
    expect(v.deviceFix).toBeNull();
    const [last] = (await t.app.inject({ url: "/v1/admin/presence-access?limit=1", headers: auth(admin) })).json().entries;
    expect(last.preciseShown).toBe(false);
  });

  it("la persona ve en su exportación cuándo se consultó, sin saber quién", async () => {
    const exp = await t.c.reports.exportData(t.c.db, reporter.userId);
    expect(exp.presenceAccesses).toHaveLength(3);
    expect(JSON.stringify(exp.presenceAccesses)).not.toContain(moderator.userId);
  });

  it("límite por hora y post sin reporte", async () => {
    const other = await createUser(t, "pres_normal");
    const plain = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(other), payload: { text: "hola vecinos" } })).json().postId;
    expect((await review(admin, { reason: "Post sin reporte asociado" }, plain)).statusCode).toBe(404);
    await t.c.db.query(
      `INSERT INTO report.presence_access_log (id, report_id, actor_user_id, reason, precise_shown, accessed_at)
       SELECT gen_random_uuid(), (SELECT id FROM report.reports WHERE post_id = $1), $2, 'relleno de prueba', false, now() FROM generate_series(1, $3)`,
      [postId, admin.userId, PRESENCE_ACCESS_PER_HOUR],
    );
    expect((await review(admin, { reason: "Una consulta de más" })).statusCode).toBe(429);
  });
});
