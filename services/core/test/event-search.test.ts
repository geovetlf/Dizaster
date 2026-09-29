import type { EventSearchResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext } from "./helpers.js";

let t: TestContext;
let fireLima: string;
let crashCallao: string;
const CALLAO = { lat: -12.0566, lng: -77.1181 };
const search = async (qs: string) => {
  const res = await t.app.inject({ url: `/v1/search/events?${qs}` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as EventSearchResponse).events.map((e) => e.id);
};
const q = (text: string, extra = "") => search(`q=${encodeURIComponent(text)}${extra}`);

beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  const a = await createUser(t, "busca_incendio");
  const b = await createUser(t, "busca_choque");
  fireLima = (await submit(t, a, reportBody(a, { category: "fire.structure", pin: offset(LIMA, 300) }))).body.eventId!;
  crashCallao = (await submit(t, b, reportBody(b, { category: "accident.traffic", pin: CALLAO }))).body.eventId!;
  await t.c.dispatcher.drain();
});
afterAll(() => t.close());

describe("búsqueda de eventos (RF-02, ADR 0065)", () => {
  it("por categoría, en cualquier idioma del catálogo", async () => {
    const es = await q("incendio");
    expect(es).toContain(fireLima);
    expect(es).not.toContain(crashCallao);
    expect(await q("Fire")).toContain(fireLima);
    expect(await q("accidente")).toContain(crashCallao);
  });

  it("categoría + lugar: cada palabra debe coincidir", async () => {
    expect(await q("incendio lima")).toContain(fireLima);
    expect(await q("incendio callao")).not.toContain(fireLima);
    expect(await q("accidente callao")).toContain(crashCallao);
    expect(await q("perú")).toEqual(expect.arrayContaining([fireLima, crashCallao]));
  });

  it("por el título de la fuente", async () => {
    await t.c.db.query(`UPDATE event.events SET title = '{"en": "M 5.1 - 20 km SW of Chimbote"}' WHERE id = $1`, [crashCallao]);
    expect(await q("chimbote")).toEqual([crashCallao]);
    // Comodines de LIKE en la búsqueda son texto, no patrones.
    expect(await q("%%")).toEqual([]);
  });

  it("vigentes primero; los archivados solo si se piden; los falsos nunca", async () => {
    await t.c.db.query(`UPDATE event.events SET status = 'ARCHIVED' WHERE id = $1`, [fireLima]);
    expect(await q("incendio")).not.toContain(fireLima);
    expect(await q("incendio", "&archived=1")).toContain(fireLima);
    await t.c.db.query(`UPDATE event.events SET status = 'ACTIVE' WHERE id = $1`, [fireLima]);
    await t.c.db.query(`UPDATE event.events SET negative_state = 'FALSE' WHERE id = $1`, [crashCallao]);
    expect(await q("accidente")).not.toContain(crashCallao);
    await t.c.db.query(`UPDATE event.events SET negative_state = 'NONE' WHERE id = $1`, [crashCallao]);
  });

  it("ordena por cercanía si hay ubicación, y solo expone datos públicos", async () => {
    const near = await q("peru", `&lat=${CALLAO.lat}&lng=${CALLAO.lng}`);
    expect(near.indexOf(crashCallao)).toBeLessThan(near.indexOf(fireLima));
    const res = (await t.app.inject({ url: "/v1/search/events?q=incendio" })).json() as EventSearchResponse;
    const hit = res.events.find((e) => e.id === fireLima)!;
    expect(Object.keys(hit)).not.toContain("geom");
    expect(JSON.stringify(hit)).not.toContain("busca_incendio");
  });

  it("valida la consulta", async () => {
    expect((await t.app.inject({ url: "/v1/search/events?q=a" })).statusCode).toBe(400);
    expect((await t.app.inject({ url: `/v1/search/events?q=${"x".repeat(81)}` })).statusCode).toBe(400);
  });
});
