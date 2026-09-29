import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

let t: TestContext;
const auth = (u: { token: string }) => ({ authorization: `Bearer ${u.token}` });
const devSignIn = async (handle: string) =>
  (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "IOS" } })).json() as TestUser & { refreshToken: string; expiresIn: number };
const refresh = (refreshToken: string) => t.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken } });

beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
});
afterAll(() => t.close());

describe("sesión con refresh rotatorio", () => {
  it("entrega acceso corto + refresh, y cada refresh sirve una sola vez", async () => {
    const s = await devSignIn("rotacion");
    expect(s.expiresIn).toBe(900);
    expect(s.refreshToken.length).toBeGreaterThan(30);
    // Solo se guarda el hash.
    const stored = await t.c.db.query(`SELECT 1 FROM identity.sessions WHERE token_hash = $1 OR token_hash = $2`, [
      s.refreshToken, createHash("sha256").update(s.refreshToken).digest("hex"),
    ]);
    expect(stored.rowCount).toBe(1);
    expect((await t.c.db.query(`SELECT 1 FROM identity.sessions WHERE token_hash = $1`, [s.refreshToken])).rowCount).toBe(0);

    const r1 = await refresh(s.refreshToken);
    expect(r1.statusCode).toBe(200);
    const p1 = r1.json() as { token: string; refreshToken: string };
    expect(p1.refreshToken).not.toBe(s.refreshToken);
    expect((await t.app.inject({ url: "/v1/me", headers: auth(p1) })).statusCode).toBe(200);

    const r2 = await refresh(p1.refreshToken);
    expect(r2.statusCode).toBe(200);
  });

  it("reusar un refresh ya rotado revoca toda la familia", async () => {
    const s = await devSignIn("robado");
    const good = (await refresh(s.refreshToken)).json() as { refreshToken: string };
    const reuse = await refresh(s.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error).toBe("INVALID_REFRESH");
    // El token legítimo más reciente también muere: hay que volver a entrar.
    expect((await refresh(good.refreshToken)).statusCode).toBe(401);
    const { rows } = await t.c.db.query<{ revoke_reason: string }>(
      `SELECT DISTINCT revoke_reason FROM identity.sessions WHERE user_id = $1`, [s.userId],
    );
    expect(rows).toEqual([{ revoke_reason: "REUSE_DETECTED" }]);
  });

  it("cerrar sesión invalida el refresh; tokens desconocidos o caducados no sirven", async () => {
    const s = await devSignIn("salir");
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: s.refreshToken } })).statusCode).toBe(204);
    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
    expect((await refresh("x".repeat(43))).statusCode).toBe(401);

    const s2 = await devSignIn("caduca");
    await t.c.db.query(`UPDATE identity.sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [s2.userId]);
    expect((await refresh(s2.refreshToken)).statusCode).toBe(401);
  });

  it("una cuenta suspendida puede renovar sesión y cerrarla", async () => {
    const s = await devSignIn("suspendida_sesion");
    await t.c.identity.setUserStatus(t.c.db, s.userId, "SUSPENDED");
    const r = await t.app.inject({ method: "POST", url: "/v1/auth/refresh", headers: auth(s), payload: { refreshToken: s.refreshToken } });
    expect(r.statusCode).toBe(200);
  });
});

describe("borrar la cuenta", () => {
  let yo: TestUser & { refreshToken: string };
  let otra: TestUser;
  let postId: string;
  let reportId: string;
  let mediaId: string;

  beforeAll(async () => {
    yo = await devSignIn("me_voy");
    otra = await createUser(t, "se_queda");
    const r = await submit(t, yo, reportBody(yo, { category: "infra.power_outage", pin: offset(LIMA, 4000), text: "Sin luz en mi cuadra" }));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    postId = r.body.postId!;
    reportId = r.body.reportId!;
    await t.c.dispatcher.drain();

    // Comentario, like, seguimientos cruzados, bloqueo, alertas y una foto subida.
    const other = await submit(t, otra, reportBody(otra, { category: "infra.power_outage", pin: offset(LIMA, 12_000), text: "Tampoco aquí" }));
    await t.c.dispatcher.drain();
    await t.app.inject({ method: "POST", url: `/v1/posts/${other.body.postId}/comments`, headers: auth(yo), payload: { text: "Ánimo vecinos" } });
    await t.app.inject({ method: "PUT", url: `/v1/posts/${other.body.postId}/like`, headers: auth(yo) });
    const h = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [yo.profileId])).rows[0]!.handle;
    const h2 = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [otra.profileId])).rows[0]!.handle;
    await t.app.inject({ method: "PUT", url: `/v1/follows/profile/${h}`, headers: auth(otra) });
    await t.app.inject({ method: "PUT", url: `/v1/follows/profile/${h2}`, headers: auth(yo) });
    expect((await t.app.inject({ method: "POST", url: "/v1/me/alert-subscriptions", headers: auth(yo), payload: { categoryCode: "natural", areaId: "PE" } })).statusCode).toBe(201);
    await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(yo), payload: { quietHours: null, nearMe: true } });
    expect((await t.app.inject({ method: "POST", url: "/v1/me/zones", headers: auth(yo), payload: { kind: "HOME", ...LIMA } })).statusCode).toBe(201);
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(yo), payload: LIMA })).json()).toEqual({ stored: true });

    const file = makeJpeg();
    const up = await t.app.inject({
      method: "POST", url: "/v1/media/uploads", headers: auth(yo),
      payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update(file).digest("hex"), width: 1920, height: 1080, capturedInApp: true },
    });
    const { mediaId: id, upload } = up.json() as { mediaId: string; upload: { url: string; headers: Record<string, string> } };
    const u = new URL(upload.url);
    await t.app.inject({ method: "PUT", url: u.pathname + u.search, headers: upload.headers, payload: file });
    await t.app.inject({ method: "POST", url: `/v1/media/${id}/complete`, headers: auth(yo) });
    await t.c.dispatcher.drain();
    mediaId = id;
    expect((await t.c.db.query(`SELECT 1 FROM media.variants WHERE media_id = $1`, [mediaId])).rowCount).toBeGreaterThan(0);
  });

  it("exige confirmación explícita", async () => {
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(yo), payload: {} })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", payload: { confirm: "DELETE" } })).statusCode).toBe(401);
  });

  it("borra, anonimiza y generaliza lo de cada módulo; el EVENT conserva la evidencia anónima", async () => {
    const keys = (await t.c.db.query<{ k: string }>(
      `SELECT storage_key_original AS k FROM media.media WHERE id = $1 AND storage_key_original IS NOT NULL
        UNION ALL SELECT storage_key FROM media.variants WHERE media_id = $1`, [mediaId],
    )).rows.map((r) => r.k);
    expect(keys.length).toBeGreaterThan(0);

    const res = await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(yo), payload: { confirm: "DELETE" } });
    expect(res.statusCode).toBe(202);
    await t.c.dispatcher.drain();

    const q = async (sql: string, p: unknown[]) => (await t.c.db.query(sql, p)).rows;
    expect(await q(`SELECT status, roles FROM identity.users WHERE id = $1`, [yo.userId])).toEqual([{ status: "DELETED", roles: [] }]);
    expect(await q(`SELECT 1 FROM identity.auth_identities WHERE user_id = $1`, [yo.userId])).toEqual([]);
    expect(await q(`SELECT 1 FROM identity.devices WHERE user_id = $1 AND push_token IS NOT NULL`, [yo.userId])).toEqual([]);
    expect(await q(`SELECT 1 FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL`, [yo.userId])).toEqual([]);

    const [profile] = await q(`SELECT handle, display_name, deleted_at IS NOT NULL AS gone FROM social.profiles WHERE id = $1`, [yo.profileId]) as { handle: string; display_name: string; gone: boolean }[];
    expect(profile!.handle).toMatch(/^borrado_[0-9a-f]{32}$/);
    expect(profile).toMatchObject({ display_name: "", gone: true });
    expect(await q(`SELECT text, deleted_at IS NOT NULL AS gone FROM social.posts WHERE id = $1`, [postId])).toEqual([{ text: null, gone: true }]);
    expect(await q(`SELECT 1 FROM social.comments WHERE author_profile_id = $1 AND deleted_at IS NULL`, [yo.profileId])).toEqual([]);
    expect(await q(`SELECT 1 FROM social.reactions WHERE profile_id = $1`, [yo.profileId])).toEqual([]);
    expect(await q(`SELECT 1 FROM social.follows WHERE follower_profile_id = $1 OR target_id = $1::text`, [yo.profileId])).toEqual([]);

    expect(await q(`SELECT coalesce(device_fix::text, device_fix_enc) AS device_fix, generalized_at IS NOT NULL AS gen FROM report.presence_evidence WHERE report_id = $1`, [reportId])).toEqual([{ device_fix: null, gen: true }]);
    expect(await q(`SELECT device_id FROM report.reports WHERE id = $1`, [reportId])).toEqual([{ device_id: null }]);

    expect(await q(`SELECT state, storage_key_original FROM media.media WHERE id = $1`, [mediaId])).toEqual([{ state: "DELETED", storage_key_original: null }]);
    expect(await q(`SELECT 1 FROM media.variants WHERE media_id = $1`, [mediaId])).toEqual([]);
    for (const k of keys) expect(await t.c.storage.stat(k)).toBeNull();

    for (const table of ["notifications", "subscriptions", "preferences", "zones", "last_locations"]) {
      expect(await q(`SELECT 1 FROM alert.${table} WHERE profile_id = $1`, [yo.profileId])).toEqual([]);
    }

    // La otra persona no nota nada roto: su feed y su perfil siguen funcionando, y la búsqueda no encuentra a la borrada.
    expect((await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(otra) })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/v1/profiles/${profile!.handle}` })).statusCode).toBe(404);
    const search = (await t.app.inject({ url: "/v1/profiles?q=me_voy" })).json() as { profiles: unknown[] };
    expect(search.profiles).toEqual([]);
  });

  it("después no se puede renovar sesión ni escribir, y volver a entrar crea una cuenta nueva", async () => {
    expect((await refresh(yo.refreshToken)).statusCode).toBe(401);
    const write = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(yo), payload: {} });
    expect(write.statusCode).toBe(403);
    const again = await devSignIn("me_voy");
    expect(again.userId).not.toBe(yo.userId);
    // Borrar dos veces no falla.
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(yo), payload: { confirm: "DELETE" } })).statusCode).toBe(202);
  });
});

describe("sesiones abiertas", () => {
  it("lista los inicios de sesión y cierra otros; el dispositivo cerrado deja de recibir avisos", async () => {
    const a = await devSignIn("multisesion");
    const b = await devSignIn("multisesion");
    expect(b.userId).toBe(a.userId);
    expect((await t.app.inject({ method: "PUT", url: `/v1/devices/${a.deviceId}/push-token`, headers: auth(a), payload: { provider: "APNS", token: `apns-${"a".repeat(40)}` } })).statusCode).toBe(204);
    // Renovar no crea otra sesión: es la misma familia.
    const b2 = (await refresh(b.refreshToken)).json() as { token: string; refreshToken: string };

    const list = (await t.app.inject({ url: "/v1/me/sessions", headers: auth(b2) })).json().sessions as { id: string; current: boolean; platform: string }[];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.every((s) => s.platform === "IOS")).toBe(true);
    const other = list.find((s) => !s.current)!;

    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/sessions/${other.id}`, headers: auth(b2) })).statusCode).toBe(204);
    expect((await refresh(a.refreshToken)).statusCode).toBe(401);
    expect((await t.c.db.query(`SELECT push_token FROM identity.devices WHERE id = $1`, [a.deviceId])).rows[0]).toEqual({ push_token: null });
    expect(((await t.app.inject({ url: "/v1/me/sessions", headers: auth(b2) })).json().sessions as unknown[])).toHaveLength(1);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/sessions/${other.id}`, headers: auth(b2) })).statusCode).toBe(404);

    // Otra persona no puede cerrar mis sesiones.
    const intruder = await devSignIn("intrusa");
    const mine = (await t.app.inject({ url: "/v1/me/sessions", headers: auth(b2) })).json().sessions[0].id as string;
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/sessions/${mine}`, headers: auth(intruder) })).statusCode).toBe(404);

    const c = await devSignIn("multisesion");
    const r = await t.app.inject({ method: "POST", url: "/v1/me/sessions/revoke-others", headers: auth(b2) });
    expect(r.json()).toEqual({ revoked: 1 });
    expect((await refresh(c.refreshToken)).statusCode).toBe(401);
    expect((await refresh(b2.refreshToken)).statusCode).toBe(200);
  });
});
