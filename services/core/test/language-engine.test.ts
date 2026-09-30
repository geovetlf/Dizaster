import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Language Engine en el servidor (ADR 0216): la base solo exige un código bien formado; los idiomas soportados los
// decide el registro compartido, y lo desconocido cae al respaldo global. NO AI REQUIRED.
let t: TestContext;
let ana: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  t = await createTestContext();
  ana = await createUser(t, "ana_idioma");
});
afterAll(() => t.close());

describe("idioma de los avisos", () => {
  it("se guarda uno soportado y la API rechaza uno que no lo es", async () => {
    const ok = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(ana), payload: { lang: "pt" } });
    expect(ok.json()).toMatchObject({ lang: "pt" });
    const bad = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(ana), payload: { lang: "de" } });
    expect(bad.statusCode).toBe(400);
  });

  it("un idioma guardado por otra versión se lee como el respaldo global; la base rechaza basura", async () => {
    await t.c.db.query(`UPDATE alert.preferences SET lang = 'qu' WHERE profile_id = $1`, [ana.profileId]);
    const r = await t.app.inject({ url: "/v1/me/alert-preferences", headers: auth(ana) });
    expect(r.json()).toMatchObject({ lang: "es" });
    await expect(t.c.db.query(`UPDATE alert.preferences SET lang = 'Español' WHERE profile_id = $1`, [ana.profileId])).rejects.toThrow(/preferences_lang_format/);
  });
});

describe("datos por país", () => {
  it("cada país tiene locale, idiomas y moneda bien formados", () => {
    const file = JSON.parse(readFileSync(new URL("../../../data/countries/country-config.json", import.meta.url), "utf8")) as
      { countries: { defaultLocale: string; languages: string[]; currency?: string }[] };
    for (const c of file.countries) {
      expect(c.defaultLocale).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
      expect(c.languages.length).toBeGreaterThan(0);
      if (c.currency !== undefined) expect(c.currency).toMatch(/^[A-Z]{3}$/);
    }
    expect(t.c.ref.country("PE")?.currency).toBe("PEN");
  });
});
