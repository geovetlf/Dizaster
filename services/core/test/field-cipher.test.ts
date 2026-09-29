import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCipher, fieldCipherFromEnv } from "../src/platform/field-cipher.js";
import { loadEnv } from "../src/platform/config.js";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext } from "./helpers.js";

describe("cifrado por columna (ADR 0048)", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it("cifra con la clave activa, descifra con cualquiera y rechaza manipulaciones o filas cambiadas", () => {
    const old = new FieldCipher("k1", { k1 });
    const sealed = old.encrypt('{"lat":-12.1}', "fila-1");
    expect(sealed).not.toContain("-12.1");
    const rotated = new FieldCipher("k2", { k2, k1 });
    expect(rotated.decrypt(sealed, "fila-1")).toBe('{"lat":-12.1}');
    expect(rotated.encrypt("x", "a").startsWith("k2.")).toBe(true);
    expect(() => rotated.decrypt(sealed, "fila-2")).toThrow();
    const [kid, iv, tag, data] = sealed.split(".");
    expect(() => rotated.decrypt([kid, iv, tag, `A${data!.slice(1)}`].join("."), "fila-1")).toThrow();
    expect(() => new FieldCipher("k2", { k1 })).toThrow();
  });

  it("lee las claves del entorno y producción las exige", () => {
    const c = fieldCipherFromEnv(`k2:${k2.toString("base64")},k1:${k1.toString("base64")}`, "x");
    expect(c.encrypt("hola", "r").startsWith("k2.")).toBe(true);
    const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(40), STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "e", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s", PUSH_DRIVER: "live" };
    expect(() => loadEnv(base)).toThrow(/FIELD_KEYS/);
  });

  describe("en la base de datos", () => {
    let t: TestContext;
    beforeAll(async () => { t = await createTestContext(); });
    afterAll(async () => { await t.close(); });

    it("el fix preciso se guarda cifrado; el export de la persona lo devuelve legible", async () => {
      const u = await createUser(t, "cifrado_a");
      const r = await submit(t, u, reportBody(u, { pin: LIMA }));
      const { rows } = await t.c.db.query<{ device_fix: unknown; device_fix_enc: string }>(
        `SELECT device_fix, device_fix_enc FROM report.presence_evidence WHERE report_id = $1`, [r.body.reportId],
      );
      expect(rows[0]!.device_fix).toBeNull();
      expect(rows[0]!.device_fix_enc).toMatch(/^dev\./);
      expect(rows[0]!.device_fix_enc).not.toContain(String(LIMA.lat).slice(0, 6));
      const exp = (await t.app.inject({ url: "/v1/me/export", headers: { authorization: `Bearer ${u.token}` } })).json();
      const mine = exp.sections.reports.reports.find((x: { id: string }) => x.id === r.body.reportId);
      expect(mine.device_fix.lat).toBeCloseTo(LIMA.lat, 3);
      expect(mine.device_fix_enc).toBeUndefined();
    });

    it("cifra las filas antiguas en claro", async () => {
      const u = await createUser(t, "cifrado_b");
      const r = await submit(t, u, reportBody(u, { pin: LIMA }));
      await t.c.db.query(`UPDATE report.presence_evidence SET device_fix = '{"lat":1,"lng":2}', device_fix_enc = NULL WHERE report_id = $1`, [r.body.reportId]);
      expect(await t.c.reports.encryptLegacyFixes()).toBeGreaterThanOrEqual(1);
      const { rows } = await t.c.db.query(`SELECT device_fix, device_fix_enc FROM report.presence_evidence WHERE report_id = $1`, [r.body.reportId]);
      expect(rows[0].device_fix).toBeNull();
      expect(rows[0].device_fix_enc).toMatch(/^dev\./);
    });
  });
});
