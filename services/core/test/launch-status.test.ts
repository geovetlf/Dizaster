import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReferenceData } from "../src/modules/reference/index.js";
import { LIMA, createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Estado de lanzamiento por país (decisión del propietario, ADR 0315 y 0317): solo PILOT y AVAILABLE aceptan reportes
 * ciudadanos; el resto queda en solo lectura. Lo decide el backend con los datos de `data/countries`, sin código por país.
 */
const SANTIAGO = { lat: -33.4489, lng: -70.6693 }; // Chile: sin entrada propia, toma el estado por defecto.
const repoData = join(import.meta.dirname, "..", "..", "..", "data");

function dataWith(edit: (config: { defaults: Record<string, unknown>; countries: Record<string, unknown>[] }) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "dz-data-"));
  cpSync(repoData, dir, { recursive: true });
  const file = join(dir, "countries", "country-config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  edit(config);
  writeFileSync(file, JSON.stringify(config));
  return dir;
}

describe("estado de lanzamiento por país", () => {
  it("los datos del repositorio: Perú es PILOT; el resto, solo lectura", () => {
    const ref = new ReferenceData(repoData);
    expect(ref.launchStatus("PE")).toBe("PILOT");
    expect(ref.acceptsCitizenReports("PE")).toBe(true);
    expect(ref.launchStatus("CL")).toBe("AVAILABLE_READ_ONLY");
    expect(ref.acceptsCitizenReports("CL")).toBe(false);
    // Sin país (mar abierto, punto fuera de los polígonos): manda el estado por defecto.
    expect(ref.acceptsCitizenReports(null)).toBe(false);
  });

  it("cada estado decide por sí mismo, y uno mal escrito no arranca", () => {
    const ref = new ReferenceData(dataWith((c) => {
      c.countries.push({ ...c.countries[0], iso2: "CL", launchStatus: "AVAILABLE" }, { ...c.countries[0], iso2: "BO", launchStatus: "RESTRICTED" });
    }));
    expect(ref.acceptsCitizenReports("CL")).toBe(true);
    expect(ref.acceptsCitizenReports("BO")).toBe(false);
    expect(() => new ReferenceData(dataWith((c) => { c.defaults.launchStatus = "OPEN"; }))).toThrow(/launchStatus desconocido/);
  });

  describe("en la API", () => {
    let t: TestContext;
    let u: TestUser;
    beforeAll(async () => { t = await createTestContext(); u = await createUser(t, "lanzamiento"); });
    afterAll(async () => { await t.close(); });

    it("fuera de PILOT o AVAILABLE el reporte se rechaza sin guardar nada; en Perú entra", async () => {
      const before = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM report.reports`)).rows[0]!.n;
      const out = await submit(t, u, reportBody(u, { pin: SANTIAGO }));
      expect(out.status).toBe(422);
      expect(out.body).toMatchObject({ outcome: "REJECTED", code: "COUNTRY_READ_ONLY" });
      expect((await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM report.reports`)).rows[0]!.n).toBe(before);
      expect((await submit(t, u, reportBody(u, { pin: LIMA }))).body.outcome).toMatch(/CREATED_EVENT|ATTACHED_TO_EVENT/);
    });

    it("la lectura sigue abierta en un país de solo lectura", async () => {
      const r = await t.app.inject({ url: `/v1/events?bbox=${SANTIAGO.lng - 1},${SANTIAGO.lat - 1},${SANTIAGO.lng + 1},${SANTIAGO.lat + 1}&zoom=10` });
      expect(r.statusCode).toBe(200);
    });
  });
});
