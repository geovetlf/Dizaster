import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("API de referencia y configuración", () => {
  it("health", async () => {
    expect((await t.app.inject({ url: "/health" })).json()).toEqual({ status: "ok" });
  });

  it("config expone un proveedor de mapa intercambiable y kill switches", async () => {
    const res = await t.app.inject({ url: "/v1/config" });
    expect(res.json()).toMatchObject({ apiVersion: "v1", map: { kind: "VECTOR_STYLE_URL" }, killSwitches: { ai: true } });
    expect(res.headers["cache-control"]).toContain("max-age");
  });

  it("detecta Perú por coordenadas y devuelve sus números de emergencia", async () => {
    const geo = (await t.app.inject({ url: "/v1/geo/country?lat=-12.0464&lng=-77.0428" })).json();
    expect(geo).toMatchObject({ country: "PE", config: { launchStatus: "PILOT", timezones: ["America/Lima"] } });
    const nums = (await t.app.inject({ url: "/v1/reference/emergency-numbers?country=PE" })).json();
    expect(nums.numbers.map((n: { number: string }) => n.number)).toEqual(expect.arrayContaining(["105", "116", "106"]));
  });

  it("con since= no repite el dataset si la app ya tiene la versión vigente", async () => {
    const full = (await t.app.inject({ url: "/v1/reference/emergency-numbers" })).json();
    expect(full.unchanged).toBe(false);
    const same = (await t.app.inject({ url: `/v1/reference/emergency-numbers?since=${full.version}` })).json();
    expect(same).toEqual({ version: full.version, unchanged: true, numbers: [] });
    const old = (await t.app.inject({ url: "/v1/reference/emergency-numbers?since=emergency-2000.01.1&country=PE" })).json();
    expect(old.unchanged).toBe(false);
    expect(old.numbers.every((n: { country: string }) => n.country === "PE")).toBe(true);
  });

  it("la arquitectura es global: cualquier país se resuelve igual", async () => {
    const geo = (await t.app.inject({ url: "/v1/geo/country?lat=35.6762&lng=139.6503" })).json();
    expect(geo.country).toBe("JP");
  });

  it("rechaza reportes sin sesión", async () => {
    expect((await t.app.inject({ method: "POST", url: "/v1/reports", payload: {} })).statusCode).toBe(401);
  });

  it("rechaza tokens manipulados", async () => {
    const res = await t.app.inject({ url: "/v1/config", headers: { authorization: "Bearer abc.def.ghi" } });
    expect(res.statusCode).toBe(401);
  });

  it("las categorías se sirven como datos versionados", async () => {
    const cats = (await t.app.inject({ url: "/v1/reference/categories" })).json();
    expect(cats.version).toMatch(/^categories-/);
    expect(cats.regionOverrides).toEqual(expect.arrayContaining([expect.objectContaining({ category: "natural.landslide", country: "PE" })]));
  });

  it("el nombre regional se aplica en Perú (huaico)", () => {
    expect(t.c.ref.category("natural.landslide", "PE")?.names["es"]).toBe("Huaico");
    expect(t.c.ref.category("natural.landslide", "CL")?.names["es"]).toBe("Huaico / deslizamiento");
  });
});
