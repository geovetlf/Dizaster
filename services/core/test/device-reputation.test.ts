import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmAge, createTestContext, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

async function userOn(handle: string, hardwareId: string | null): Promise<TestUser> {
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", ...(hardwareId ? { hardwareId } : {}) } });
  expect(res.statusCode, res.body).toBe(200);
  const u = res.json() as TestUser;
  await confirmAge(t, u);
  await t.c.db.query(`UPDATE identity.users SET created_at = now() - interval '40 days' WHERE id = $1`, [u.userId]);
  return u;
}

async function reportAll(users: TestUser[], pin: { lat: number; lng: number }) {
  let eventId = "";
  for (const [i, u] of users.entries()) {
    const r = await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(pin, i * 10), ...(eventId ? { targetEventId: eventId } : {}) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    eventId ||= r.body.eventId!;
    await t.c.dispatcher.drain();
  }
  return (await t.c.db.query<{ level: string }>(`SELECT level FROM verification.state WHERE event_id = $1`, [eventId])).rows[0]!.level;
}

const PHONE = "hw_" + "a".repeat(40);

describe("reputación por dispositivo (ADR 0068)", () => {
  it("tres cuentas en el mismo teléfono corroboran como una", async () => {
    const same = [await userOn("tel_uno_a", PHONE), await userOn("tel_uno_b", PHONE), await userOn("tel_uno_c", PHONE)];
    expect(await reportAll(same, { lat: -12.3, lng: -76.8 })).toBe("UNVERIFIED");
  });

  it("tres cuentas en teléfonos distintos sí corroboran", async () => {
    const apart = [await userOn("tel_dos_a", "hw_" + "b".repeat(40)), await userOn("tel_dos_b", "hw_" + "c".repeat(40)), await userOn("tel_dos_c", null)];
    expect(await reportAll(apart, { lat: -12.4, lng: -76.7 })).toBe("COMMUNITY_CORROBORATED");
  });

  it("no se guarda el identificador del teléfono, solo una clave seudónima", async () => {
    const { rows } = await t.c.db.query<{ hardware_key: string }>(`SELECT DISTINCT hardware_key FROM identity.devices WHERE hardware_key IS NOT NULL`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.hardware_key).not.toContain("aaaa");
      expect(r.hardware_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(t.c.identity.hardwareKey("ANDROID", PHONE)).not.toBe(t.c.identity.hardwareKey("IOS", PHONE));
  });

  it("rechaza identificadores con formato inesperado", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "tel_malo", platform: "ANDROID", hardwareId: "corto" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("cupos y reputación por teléfono (ADR 0131)", () => {
  const send = (u: TestUser, i: number, extra: Parameters<typeof reportBody>[1] = {}) =>
    submit(t, u, reportBody(u, { category: "fire.structure", pin: offset({ lat: -13, lng: -76 }, 0, i * 5000), ...extra }));

  it("las cuentas de un mismo teléfono comparten el cupo por hora", async () => {
    const phone = "hw_" + "d".repeat(40);
    const a = await userOn("cupo_a", phone);
    const b = await userOn("cupo_b", phone);
    for (let i = 0; i < 3; i++) expect((await send(a, i)).status).toBe(200);
    for (let i = 3; i < 5; i++) expect((await send(b, i)).status).toBe(200);
    expect((await send(b, 5)).status).toBe(429);
    // Otra cuenta en otro teléfono no se ve afectada.
    expect((await send(await userOn("cupo_c", "hw_" + "e".repeat(40)), 6)).status).toBe(200);
  });

  it("una cuenta suspendida en el teléfono baja el cupo de las demás (evasión de sanción)", async () => {
    const phone = "hw_" + "f".repeat(40);
    const banned = await userOn("cupo_sancion", phone);
    await t.c.db.query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [banned.userId]);
    const fresh = await userOn("cupo_nueva", phone);
    expect((await send(fresh, 10)).status).toBe(200);
    expect((await send(fresh, 11)).status).toBe(429);
  });

  it("señales repetidas de manipulación en 30 días bajan el cupo del teléfono", async () => {
    const phone = "hw_" + "0".repeat(40);
    const a = await userOn("cupo_mock", phone);
    for (let i = 0; i < 3; i++) await send(a, 20 + i, { mock: true });
    await t.c.db.query(`UPDATE report.reports SET received_at = now() - interval '2 hours' WHERE author_user_id = $1`, [a.userId]);
    const b = await userOn("cupo_mock_b", phone);
    expect((await send(b, 30)).status).toBe(200);
    expect((await send(b, 31)).status).toBe(429);
  });
});

