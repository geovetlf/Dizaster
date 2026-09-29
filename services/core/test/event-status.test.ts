import type { EventSummary, ModeratorEventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let mod: TestUser;
let user: TestUser;
let id: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const setStatus = (u: TestUser, payload: Record<string, string>) => t.app.inject({ method: "POST", url: `/v1/moderation/events/${id}/status`, headers: auth(u), payload });

beforeAll(async () => {
  t = await createTestContext();
  const m = await createUser(t, "mod_ciclo");
  await t.c.identity.grantRole(m.userId, "moderator");
  mod = { ...m, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_ciclo", platform: "ANDROID", deviceId: m.deviceId } })).json().token };
  user = await createUser(t, "vecino_ciclo");
  id = (await submit(t, user, reportBody(user, { category: "fire.structure", pin: LIMA }))).body.eventId!;
  await t.c.dispatcher.drain();
});
afterAll(() => t.close());

describe("ciclo de vida manual de un evento (ADR 0053)", () => {
  it("solo moderación, con motivo, y no al mismo estado", async () => {
    expect((await setStatus(user, { to: "RESOLVED", reason: "Ya se apagó" })).statusCode).toBe(403);
    expect((await setStatus(mod, { to: "RESOLVED", reason: "" })).statusCode).toBe(400);
    expect((await setStatus(mod, { to: "ACTIVE", reason: "Sigue activo" })).statusCode).toBe(409);
  });

  it("cierra, queda auditado y en la línea de tiempo sin exponer a quién", async () => {
    const res = await setStatus(mod, { to: "RESOLVED", reason: "Bomberos confirmaron que se apagó" });
    expect(res.statusCode).toBe(200);
    const d = res.json() as ModeratorEventDetail;
    expect(d.status).toBe("RESOLVED");
    expect(d.statusChanges[0]).toMatchObject({ from: "ACTIVE", to: "RESOLVED", reason: "Bomberos confirmaron que se apagó" });
    expect(((await t.app.inject({ url: `/v1/events/${id}` })).json() as EventSummary).status).toBe("RESOLVED");
    const tl = (await t.app.inject({ url: `/v1/events/${id}/timeline` })).json().entries as { type: string; payload: Record<string, unknown> }[];
    const entry = tl.find((e) => e.type === "STATUS_CHANGED")!;
    expect(entry.payload).toEqual({ from: "ACTIVE", to: "RESOLVED", cause: "MODERATION" });
    const log = await t.c.db.query(`SELECT actor FROM event.status_log WHERE event_id = $1`, [id]);
    expect(log.rows[0]!.actor).toBe(mod.userId);
  });

  it("reactivar reinicia el reloj de inactividad", async () => {
    await t.c.db.query(`UPDATE event.events SET last_activity_at = now() - interval '30 days' WHERE id = $1`, [id]);
    expect((await setStatus(mod, { to: "ACTIVE", reason: "Se reavivó el fuego" })).statusCode).toBe(200);
    const moved = await t.c.events.applyLifecycle(t.c.db, new Date());
    expect(moved.resolved + moved.monitoring).toBe(0);
    const { rows } = await t.c.db.query<{ status: string }>(`SELECT status FROM event.events WHERE id = $1`, [id]);
    expect(rows[0]!.status).toBe("ACTIVE");
  });
});
