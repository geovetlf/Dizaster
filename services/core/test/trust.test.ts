import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coordinatedWeights, reportQuota, tierFor, type ReputationSignals } from "../src/modules/trust/index.js";
import { withTransaction } from "../src/platform/db.js";
import { publish } from "../src/platform/outbox.js";
import { createTestContext, createUser, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

const base: ReputationSignals = { accountAgeHours: 24 * 90, corroborated: 0, falseReports: 0, removals: 0, suspensions: 0 };

describe("reglas de reputación (puras)", () => {
  it("niveles", () => {
    expect(tierFor({ ...base, accountAgeHours: 3 })).toBe("NEW");
    expect(tierFor(base)).toBe("STANDARD");
    expect(tierFor({ ...base, corroborated: 5 })).toBe("TRUSTED");
    expect(tierFor({ ...base, corroborated: 5, accountAgeHours: 24 * 10 })).toBe("STANDARD");
    expect(tierFor({ ...base, corroborated: 9, falseReports: 1 })).toBe("STANDARD");
    expect(tierFor({ ...base, falseReports: 2, corroborated: 1 })).toBe("LOW");
    expect(tierFor({ ...base, falseReports: 2, corroborated: 8 })).toBe("STANDARD");
    expect(tierFor({ ...base, corroborated: 50, suspensions: 1 })).toBe("LOW");
    expect(tierFor({ ...base, removals: 2 })).toBe("LOW");
    // Una cuenta nueva sancionada no se beneficia de ser nueva.
    expect(tierFor({ ...base, accountAgeHours: 1, removals: 2 })).toBe("LOW");
  });

  it("cupo de reportes: nunca cero", () => {
    expect(reportQuota("STANDARD", 5)).toBe(5);
    expect(reportQuota("TRUSTED", 5)).toBe(5);
    expect(reportQuota("NEW", 5)).toBe(2);
    expect(reportQuota("LOW", 5)).toBe(1);
    expect(reportQuota("LOW", 1)).toBe(1);
  });

  it("un grupo coordinado aporta solo su mayor peso; los demás no cambian", () => {
    const w = new Map([["a", 1], ["b", 1.5], ["c", 1], ["d", 1], ["e", 0.5]]);
    const out = coordinatedWeights(w, [["a", "b"], ["b", "c"], ["d", "x"]]);
    expect([...out.values()].reduce((s, x) => s + x, 0)).toBe(1.5 + 1 + 0.5);
    expect(out.get("b")).toBe(1.5);
    expect(out.get("a")).toBe(0);
    expect(out.get("d")).toBe(1);
  });
});

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const level = async (eventId: string) =>
  (await t.c.db.query<{ level: string }>(`SELECT level FROM verification.state WHERE event_id = $1`, [eventId])).rows[0]!.level;

/** Historial previo sembrado directamente: `n` eventos confirmados en los que la persona reportó. */
async function history(u: TestUser, n: number, outcome: "CONFIRMED" | "FALSE" = "CONFIRMED", daysAgo = 20) {
  for (let i = 0; i < n; i++) {
    const eventId = randomUUID();
    await t.c.db.query(`INSERT INTO trust.contributions (user_id, event_id, assertion, created_at) VALUES ($1, $2, 'OCCURRING', now() - make_interval(days => $3))`, [u.userId, eventId, daysAgo]);
    await t.c.db.query(`INSERT INTO trust.event_outcomes (event_id, outcome) VALUES ($1, $2)`, [eventId, outcome]);
  }
}

async function reportAll(users: TestUser[], category: string, pin: { lat: number; lng: number }) {
  let eventId = "";
  for (const [i, u] of users.entries()) {
    const r = await submit(t, u, reportBody(u, { category, pin: offset(pin, i * 10), ...(eventId ? { targetEventId: eventId } : {}) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    eventId ||= r.body.eventId!;
    await t.c.dispatcher.drain();
  }
  return eventId;
}

describe("reputación en la verificación, cupos y denuncias", () => {
  it("dos personas de confianza con presencia alta corroboran; dos normales no", async () => {
    const trusted = [await createUser(t, "confiable1", 24 * 40), await createUser(t, "confiable2", 24 * 40)];
    for (const u of trusted) await history(u, 5);
    expect(await level(await reportAll(trusted, "fire.structure", { lat: -12.08, lng: -77.05 }))).toBe("COMMUNITY_CORROBORATED");

    const normal = [await createUser(t, "normal1", 24 * 40), await createUser(t, "normal2", 24 * 40)];
    expect(await level(await reportAll(normal, "fire.structure", { lat: -12.2, lng: -76.95 }))).toBe("UNVERIFIED");
  });

  it("cuentas jóvenes que ya reportaron juntas en otros eventos cuentan como una", async () => {
    const farm = await Promise.all([1, 2, 3].map((i) => createUser(t, `granja${i}`)));
    for (let k = 0; k < 2; k++) {
      const eventId = randomUUID();
      for (const u of farm) {
        await t.c.db.query(`INSERT INTO trust.contributions (user_id, event_id, assertion, created_at) VALUES ($1, $2, 'OCCURRING', now() - interval '1 day')`, [u.userId, eventId]);
      }
    }
    expect(await level(await reportAll(farm, "fire.structure", { lat: -12.3, lng: -76.8 }))).toBe("UNVERIFIED");

    // Las mismas coincidencias hace un mes ya no enlazan (fuera de la ventana de 7 días).
    const vecinos = await Promise.all([1, 2, 3].map((i) => createUser(t, `vecinos${i}`)));
    const old = randomUUID();
    const old2 = randomUUID();
    for (const u of vecinos) {
      for (const e of [old, old2]) {
        await t.c.db.query(`INSERT INTO trust.contributions (user_id, event_id, assertion, created_at) VALUES ($1, $2, 'OCCURRING', now() - interval '30 days')`, [u.userId, e]);
      }
    }
    expect(await level(await reportAll(vecinos, "fire.structure", { lat: -12.4, lng: -76.7 }))).toBe("COMMUNITY_CORROBORATED");
  });

  it("el resultado del evento alimenta la reputación: reportar algo declarado FALSO resta", async () => {
    const u = await createUser(t, "mentiroso", 24 * 40);
    const others = await Promise.all([1, 2].map((i) => createUser(t, `testigo${i}`)));
    const eventId = await reportAll([u, ...others], "fire.structure", { lat: -12.5, lng: -76.6 });
    expect(await t.c.trust.signals(t.c.db, [u.userId]).then((m) => m.get(u.userId)!.corroborated)).toBe(1);

    await withTransaction(t.c.db, (tx) => publish(tx, "VerificationChanged", { eventId, from: "COMMUNITY_CORROBORATED", to: "COMMUNITY_CORROBORATED", negativeState: "FALSE" }));
    await t.c.dispatcher.drain();
    await history(u, 1, "FALSE");
    const s = (await t.c.trust.signals(t.c.db, [u.userId])).get(u.userId)!;
    expect(s).toMatchObject({ corroborated: 0, falseReports: 2 });
    expect((await t.c.trust.tiers(t.c.db, [u.userId])).get(u.userId)).toBe("LOW");
  });

  it("sanciones de moderación bajan la reputación y una apelación aceptada las revierte; baja el cupo y el peso de sus denuncias", async () => {
    const u = await createUser(t, "sancionada", 24 * 40);
    const act = (actionId: string, action: string, reverses: string | null = null) =>
      withTransaction(t.c.db, (tx) => publish(tx, "ModerationActionTaken", { actionId, targetType: "POST", targetId: randomUUID(), action, actor: "MODERATOR", affectedUserId: u.userId, reverses }));
    const a1 = randomUUID();
    await act(a1, "REMOVE");
    await act(randomUUID(), "HIDE");
    // Las reglas automáticas no cuentan como sanción.
    await withTransaction(t.c.db, (tx) => publish(tx, "ModerationActionTaken", { actionId: randomUUID(), targetType: "POST", targetId: randomUUID(), action: "LIMIT", actor: "RULE", affectedUserId: u.userId, reverses: null }));
    await t.c.dispatcher.drain();
    expect((await t.c.trust.tiers(t.c.db, [u.userId])).get(u.userId)).toBe("LOW");
    expect(await t.c.trust.flagWeight(t.c.db, u.userId)).toBe(0.25);

    const first = await submit(t, u, reportBody(u, { category: "fire.structure", pin: { lat: -12.6, lng: -76.5 } }));
    expect(first.status).toBe(200);
    const second = await submit(t, u, reportBody(u, { category: "fire.structure", pin: { lat: -12.61, lng: -76.5 } }));
    expect(second.status).toBe(429);

    await act(randomUUID(), "RESTORE", a1);
    await t.c.dispatcher.drain();
    expect((await t.c.trust.tiers(t.c.db, [u.userId])).get(u.userId)).toBe("STANDARD");
    expect(await t.c.trust.flagWeight(t.c.db, u.userId)).toBe(1);
  });
});
