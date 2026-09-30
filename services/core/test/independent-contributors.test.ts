import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { independentContributors } from "../src/modules/event/index.js";
import { confirmAge, createTestContext, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Corroborar exige personas en teléfonos distintos (ADR 0213, §10.2).
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

async function userOn(handle: string, hardwareId: string): Promise<TestUser> {
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", hardwareId } });
  expect(res.statusCode, res.body).toBe(200);
  const u = res.json() as TestUser;
  await confirmAge(t, u);
  await t.c.db.query(`UPDATE identity.users SET created_at = now() - interval '40 days' WHERE id = $1`, [u.userId]);
  return u;
}
const state = async (eventId: string) =>
  (await t.c.db.query<{ publication_state: string }>(`SELECT publication_state FROM event.events WHERE id = $1`, [eventId])).rows[0]!.publication_state;

describe("contribuyentes independientes", () => {
  it("cuenta una vez por persona y una vez por teléfono", () => {
    expect(independentContributors([{ userId: "a", deviceId: "p1" }, { userId: "b", deviceId: "p1" }])).toBe(1);
    expect(independentContributors([{ userId: "a", deviceId: "p1" }, { userId: "b", deviceId: "p2" }])).toBe(2);
    expect(independentContributors([{ userId: "a", deviceId: "p1" }, { userId: "a", deviceId: "p2" }])).toBe(1);
    expect(independentContributors([{ userId: "a", deviceId: null }, { userId: "b", deviceId: null }, { userId: null, deviceId: "p3" }])).toBe(2);
  });

  it("dos cuentas en el mismo teléfono no publican un evento pendiente; otro teléfono sí", async () => {
    const [a, b, c] = [
      await userOn("mismo_tel_a", "hw-corrobora-mismo-telefono-0001"),
      await userOn("mismo_tel_b", "hw-corrobora-mismo-telefono-0001"),
      await userOn("otro_tel_c", "hw-corrobora-otro-telefono-00002"),
    ];
    const pin = offset(LIMA, -15000);
    const r1 = await submit(t, a, reportBody(a, { pin, attestation: null, category: "fire.structure" }));
    expect(r1.body).toMatchObject({ outcome: "CREATED_EVENT", presenceBand: "MEDIUM" });
    const eventId = r1.body.eventId!;
    const r2 = await submit(t, b, reportBody(b, { pin: offset(pin, 20), category: "fire.structure", targetEventId: eventId }));
    expect(r2.body.eventId).toBe(eventId);
    expect(await state(eventId)).toBe("PENDING_CORROBORATION");
    const r3 = await submit(t, c, reportBody(c, { pin: offset(pin, 40), category: "fire.structure", targetEventId: eventId }));
    expect(r3.body.eventId).toBe(eventId);
    expect(await state(eventId)).toBe("PUBLISHED");
  });
});
