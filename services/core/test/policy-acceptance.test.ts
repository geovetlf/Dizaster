import type { LegalDocumentsFile, PolicyStatusResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Aceptación versionada de términos y políticas (ADR 0176). Solo el mecanismo: los textos reales siguen bloqueados.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const setLegal = (documents: LegalDocumentsFile["documents"]) => { (t.c.ref as { legal: LegalDocumentsFile }).legal = { version: "test", documents }; };
const status = async (u: TestUser) => (await t.app.inject({ url: "/v1/me/policies", headers: auth(u) })).json() as PolicyStatusResponse;

describe("aceptación de términos", () => {
  it("el archivo real aún no tiene textos: nada que aceptar y nada bloquea", async () => {
    expect(t.c.ref.legal.documents.every((d) => d.version === null)).toBe(true);
    const u = await createUser(t, "legal_none");
    expect(await status(u)).toEqual({ documents: [] });
    expect((await submit(t, u, reportBody(u))).status).toBe(200);
  });

  it("con una versión obligatoria publicada, publicar pide aceptarla; aceptada, sigue; una versión nueva la pide otra vez", async () => {
    const u = await createUser(t, "legal_req");
    setLegal([
      { kind: "TERMS", version: "2026-10", url: "https://example.org/terms", required: true },
      { kind: "COMMUNITY_GUIDELINES", version: "1", url: "https://example.org/rules", required: false },
      { kind: "PRIVACY", version: null, url: null, required: true },
    ]);
    const s = await status(u);
    expect(s.documents.map((d) => [d.kind, d.pending])).toEqual([["TERMS", true], ["COMMUNITY_GUIDELINES", true]]);
    const blocked = await submit(t, u, reportBody(u));
    expect(blocked.status).toBe(428);
    expect(blocked.body).toMatchObject({ error: "POLICY_ACCEPTANCE_REQUIRED" });
    // Leer y ajustes no se bloquean.
    expect((await t.app.inject({ url: "/v1/me", headers: auth(u) })).statusCode).toBe(200);

    const wrong = await t.app.inject({ method: "POST", url: "/v1/me/policies/accept", headers: auth(u), payload: { accept: [{ kind: "TERMS", version: "2026-09" }] } });
    expect(wrong.statusCode).toBe(409);
    const ok = await t.app.inject({
      method: "POST", url: "/v1/me/policies/accept", headers: { ...auth(u), "x-app-platform": "android", "x-app-version": "1.0.0" },
      payload: { accept: [{ kind: "TERMS", version: "2026-10" }] },
    });
    expect(ok.statusCode).toBe(204);
    expect((await submit(t, u, reportBody(u))).status).toBe(200);
    expect((await status(u)).documents.find((d) => d.kind === "TERMS")).toMatchObject({ pending: false, acceptedVersion: "2026-10" });

    setLegal([{ kind: "TERMS", version: "2026-11", url: "https://example.org/terms", required: true }]);
    // La caché es por conjunto de versiones: el cambio se nota al instante.
    expect((await submit(t, u, reportBody(u))).status).toBe(428);
    expect((await status(u)).documents[0]).toMatchObject({ pending: true, acceptedVersion: "2026-10" });
  });

  it("el registro es de solo inserción", async () => {
    await expect(t.c.db.query(`DELETE FROM identity.policy_acceptances`)).rejects.toThrow(/solo se inserta/);
    const r = await t.c.db.query<{ platform: string; app_version: string }>(`SELECT platform, app_version FROM identity.policy_acceptances`);
    expect(r.rows).toEqual([{ platform: "android", app_version: "1.0.0" }]);
  });

  it("al borrar la cuenta queda solo id interno, documento, versión y fecha (ADR 0184)", async () => {
    const u = await createUser(t, "legal_gone");
    setLegal([{ kind: "TERMS", version: "2026-12", url: "https://example.org/terms", required: true }]);
    const ok = await t.app.inject({
      method: "POST", url: "/v1/me/policies/accept", headers: { ...auth(u), "x-app-platform": "ios", "x-app-version": "1.2.0" },
      payload: { accept: [{ kind: "TERMS", version: "2026-12" }] },
    });
    expect(ok.statusCode).toBe(204);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(u), payload: { confirm: "DELETE" } })).statusCode).toBeLessThan(300);
    const r = await t.c.db.query(`SELECT kind, version, platform, app_version, accepted_at IS NOT NULL AS dated FROM identity.policy_acceptances WHERE user_id = $1`, [u.userId]);
    expect(r.rows).toEqual([{ kind: "TERMS", version: "2026-12", platform: null, app_version: null, dated: true }]);
    // Nada más se puede cambiar.
    await expect(t.c.db.query(`UPDATE identity.policy_acceptances SET version = 'x' WHERE user_id = $1`, [u.userId])).rejects.toThrow(/solo se inserta/);
  });
});
