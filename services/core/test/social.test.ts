import type { FeedResponse, MyFollows, ProfileSearchResult, ProfileView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../src/platform/db.js";
import { publish } from "../src/platform/outbox.js";
import { createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const get = async <T>(url: string, u?: TestUser) => {
  const res = await t.app.inject({ url, ...(u ? { headers: auth(u) } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
};
const follow = (u: TestUser, target: string, id: string, on = true) =>
  t.app.inject({ method: on ? "PUT" : "DELETE", url: `/v1/follows/${target}/${encodeURIComponent(id)}`, headers: auth(u) });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
const texts = (r: FeedResponse) => r.posts.map((p) => p.text);
const MIRAFLORES = { lat: -12.1211, lng: -77.0297 };

describe("seguir perfiles", () => {
  let ana: TestUser;
  let beto: TestUser;
  let anaHandle: string;

  beforeAll(async () => {
    ana = await createUser(t, "Ana Quispe");
    beto = await createUser(t, "beto");
    anaHandle = await handleOf(ana);
    await submit(t, ana, reportBody(ana, { category: "infra.power_outage", pin: offset(LIMA, 12_000), text: "Sin luz en la avenida" }));
    await submit(t, ana, { ...reportBody(ana, { category: "crime.robbery", pin: offset(LIMA, 15_000), text: "Robo reportado en reserva" }), anonymityMode: "PSEUDONYMOUS" });
    await t.c.dispatcher.drain();
  });

  it("busca personas por handle o nombre", async () => {
    const byName = await get<{ profiles: ProfileSearchResult[] }>("/v1/profiles?q=quis");
    expect(byName.profiles.map((p) => p.handle)).toContain(anaHandle);
    const byHandle = await get<{ profiles: ProfileSearchResult[] }>(`/v1/profiles?q=@${anaHandle.slice(0, 6)}`);
    expect(byHandle.profiles[0]).toMatchObject({ handle: anaHandle, displayName: "Ana Quispe", followedByMe: false });
    expect((await t.app.inject({ url: "/v1/profiles?q=a" })).statusCode).toBe(400);
  });

  it("seguir es idempotente y el feed Siguiendo muestra solo sus posts públicos, nunca los seudónimos", async () => {
    expect((await follow(beto, "profile", anaHandle)).json()).toEqual({ following: true });
    expect((await follow(beto, "profile", anaHandle)).statusCode).toBe(200);
    const feed = await get<FeedResponse>("/v1/feed?tab=following", beto);
    expect(texts(feed)).toEqual(["Sin luz en la avenida"]);
    expect(JSON.stringify(feed)).not.toContain("Robo reportado en reserva");
  });

  it("perfil público: contadores sin posts seudónimos y posts del perfil", async () => {
    const view = await get<ProfileView>(`/v1/profiles/${anaHandle}`, beto);
    expect(view).toMatchObject({ handle: anaHandle, displayName: "Ana Quispe", followerCount: 1, followingCount: 0, postCount: 1, followedByMe: true, isMe: false });
    expect((await get<ProfileView>(`/v1/profiles/${anaHandle}`, ana)).isMe).toBe(true);
    expect(await get<ProfileView>("/v1/me", ana)).toMatchObject({ handle: anaHandle, isMe: true, postCount: 1 });
    expect(texts(await get<FeedResponse>(`/v1/profiles/${anaHandle}/posts`))).toEqual(["Sin luz en la avenida"]);
    expect((await t.app.inject({ url: "/v1/profiles/no_existe_zz" })).statusCode).toBe(404);
  });

  it("no se puede seguir a uno mismo ni a quien no existe; dejar de seguir funciona", async () => {
    expect((await follow(ana, "profile", anaHandle)).statusCode).toBe(400);
    expect((await follow(ana, "profile", "no_existe_zz")).statusCode).toBe(404);
    expect((await follow(ana, "user", "x")).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: `/v1/follows/profile/${anaHandle}` })).statusCode).toBe(401);
    expect((await follow(beto, "profile", anaHandle, false)).json()).toEqual({ following: false });
    expect((await get<FeedResponse>("/v1/feed?tab=following", beto)).posts).toEqual([]);
  });
});

describe("seguir eventos y lugares", () => {
  let carla: TestUser;
  let dani: TestUser;
  let eventId: string;

  beforeAll(async () => {
    carla = await createUser(t, "carla");
    dani = await createUser(t, "dani");
    const first = await submit(t, carla, reportBody(carla, { category: "natural.flood", pin: MIRAFLORES, text: "Se inunda la calle" }));
    eventId = first.body.eventId!;
    await t.c.dispatcher.drain();
  });

  it("seguir un evento trae al feed lo que otros publican sobre él", async () => {
    expect((await follow(dani, "event", eventId)).statusCode).toBe(200);
    const other = await createUser(t, "vecino");
    const r = await submit(t, other, reportBody(other, { category: "natural.flood", pin: offset(MIRAFLORES, 40), text: "Confirmo, sube el agua" }));
    expect(r.body.eventId).toBe(eventId);
    expect(texts(await get<FeedResponse>("/v1/feed?tab=following", dani))).toEqual(["Confirmo, sube el agua", "Se inunda la calle"]);
    expect((await follow(dani, "event", "00000000-0000-7000-8000-000000000000")).statusCode).toBe(404);
    await follow(dani, "event", eventId, false);
  });

  it("seguir un lugar (distrito) trae los eventos que ocurren en él", async () => {
    expect((await follow(dani, "place", "PE:150122")).statusCode).toBe(200);
    const far = await createUser(t, "lejano");
    await submit(t, far, reportBody(far, { category: "fire.structure", pin: { lat: -12.0566, lng: -77.1181 }, text: "Incendio en Callao" }));
    await t.c.dispatcher.drain();
    const feed = await get<FeedResponse>("/v1/feed?tab=following", dani);
    expect(texts(feed)).toContain("Se inunda la calle");
    expect(texts(feed)).not.toContain("Incendio en Callao");
    expect(feed.posts[0]!.place?.label).toBe("Miraflores, Lima");
    expect((await follow(dani, "place", "PE:999999")).statusCode).toBe(404);
    expect((await follow(dani, "place", "no valido")).statusCode).toBe(400);
  });

  it("lista lo que sigo con nombres legibles", async () => {
    await follow(dani, "profile", await handleOf(carla));
    const mine = await get<MyFollows>("/v1/me/follows", dani);
    expect(mine.profiles).toEqual([{ handle: await handleOf(carla), displayName: "carla" }]);
    expect(mine.places).toEqual([{ id: "PE:150122", name: "Miraflores", label: "Miraflores, Lima" }]);
    expect(mine.events).toEqual([]);
  });
});

describe("orden de Para ti", () => {
  let u: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    u = await createUser(t, "ranker");
    // Mismo tipo y severidad, lejos de todo lo anterior: solo cambian verificación y cercanía.
    for (const [name, north] of [["viejo", 300_000], ["medio", 400_000], ["nuevo", 500_000]] as const) {
      const r = await submit(t, u, reportBody(u, { category: "infra.water_outage", pin: offset(LIMA, north), text: `rank-${name}` }));
      ids[name] = r.body.eventId!;
    }
    await t.c.dispatcher.drain();
  });

  const rankOrder = async (qs = "") =>
    texts(await get<FeedResponse>(`/v1/feed?tab=for_you&category=infra.water_outage&limit=30${qs}`)).filter((x) => x?.startsWith("rank-"));

  it("a igualdad de señales, lo más reciente primero", async () => {
    expect(await rankOrder()).toEqual(["rank-nuevo", "rank-medio", "rank-viejo"]);
  });

  it("confirmación oficial sube; FALSE baja; cambia por el evento de dominio, sin leer el esquema event", async () => {
    await withTransaction(t.c.db, async (tx) => {
      await publish(tx, "VerificationChanged", { eventId: ids["viejo"]!, from: "UNVERIFIED", to: "OFFICIALLY_CONFIRMED", negativeState: "NONE" });
      await publish(tx, "VerificationChanged", { eventId: ids["nuevo"]!, from: "UNVERIFIED", to: "UNVERIFIED", negativeState: "FALSE" });
    });
    await t.c.dispatcher.drain();
    expect(await rankOrder()).toEqual(["rank-viejo", "rank-medio", "rank-nuevo"]);
  });

  it("la cercanía del lector sube lo cercano y el cursor no repite ni salta", async () => {
    const near = offset(LIMA, 400_000);
    expect((await rankOrder(`&lat=${near.lat}&lng=${near.lng}`))[0]).toBe("rank-medio");
    const all = await rankOrder();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: FeedResponse = await get<FeedResponse>(`/v1/feed?tab=for_you&category=infra.water_outage&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...texts(page).filter((x): x is string => !!x));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.filter((x) => x.startsWith("rank-"))).toEqual(all);
  });
});
