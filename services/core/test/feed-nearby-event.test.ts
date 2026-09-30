import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Feed "Cerca" por la ubicación del evento (§5.3, ADR 0255). NO AI REQUIRED.
let t: TestContext;
let author: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const nearby = async (at: { lat: number; lng: number }) =>
  ((await t.app.inject({ url: `/v1/feed?tab=nearby&lat=${at.lat}&lng=${at.lng}`, headers: auth(author) })).json() as FeedResponse).posts;

beforeAll(async () => {
  t = await createTestContext();
  author = await createUser(t, "cerca_evento");
});
afterAll(() => t.close());

describe("feed Cerca", () => {
  it("incluye posts sin ubicación propia ligados a un evento cercano, con la distancia del punto público del evento", async () => {
    await submit(t, author, reportBody(author, { category: "fire.structure", pin: offset(LIMA, 2000), text: "Incendio en el mercado" }));
    await t.c.dispatcher.drain();
    const eventId = (await nearby(LIMA)).find((p) => p.text === "Incendio en el mercado")!.event!.id;
    const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(author), payload: { text: "¿Alguien sabe si cerraron la avenida?", eventId } });
    expect(res.statusCode, res.body).toBe(201);
    await t.c.dispatcher.drain();

    const near = (await nearby(LIMA)).find((p) => p.text === "¿Alguien sabe si cerraron la avenida?");
    expect(near?.distanceBucket).toBe("<5km");
    // Lejos del evento no aparece.
    expect((await nearby({ lat: -16.4, lng: -71.54 })).map((p) => p.text)).not.toContain("¿Alguien sabe si cerraron la avenida?");
  });
});
