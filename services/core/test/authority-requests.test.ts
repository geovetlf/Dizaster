import type { AuthorityRequestDetail, TransparencyReport } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Registro auditado de requerimientos de autoridades (ADR 0139): solo registro, sin entrega de datos. NO AI REQUIRED.
let t: TestContext;
let admin: TestUser;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function asRole(handle: string, role: "moderator" | "admin"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

beforeAll(async () => {
  t = await createTestContext();
  admin = await asRole("admin1", "admin");
  mod = await asRole("moderadora", "moderator");
});
afterAll(async () => { await t.close(); });

describe("requerimientos de autoridades", () => {
  const body = (u: TestUser) => ({
    authority: "Fiscalía Provincial de Lima",
    country: "PE",
    externalReference: "Oficio 123-2026",
    type: "DATA_DISCLOSURE",
    channel: "EMAIL",
    receivedAt: new Date(Date.now() - 3600_000).toISOString(),
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    subjectRefs: [`user:${u.userId}`],
    summary: "Solicita datos de una cuenta.",
  });

  it("solo administración registra y consulta", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/admin/authority-requests", headers: auth(mod), payload: body(mod) });
    expect(res.statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/admin/authority-requests", headers: auth(mod) })).statusCode).toBe(403);
  });

  it("no acepta datos personales como referencia: solo identificadores internos", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/admin/authority-requests", headers: auth(admin),
      payload: { ...body(mod), subjectRefs: ["Juan Pérez +51 999 999 999"] } });
    expect(res.statusCode).toBe(400);
  });

  it("registra, cambia de estado con nota y deja todo en un historial inalterable", async () => {
    const created = await t.app.inject({ method: "POST", url: "/v1/admin/authority-requests", headers: auth(admin), payload: body(mod) });
    expect(created.statusCode).toBe(201);
    const r = created.json() as AuthorityRequestDetail;
    expect(r).toMatchObject({ status: "RECEIVED", overdue: true, subjectRefs: [`user:${mod.userId}`] });
    const url = `/v1/admin/authority-requests/${r.id}`;

    // Responder exige pasar antes por revisión legal.
    const early = await t.app.inject({ method: "POST", url: `${url}/status`, headers: auth(admin), payload: { status: "ANSWERED", note: "Respondido" } });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: "AUTHORITY_REQUEST_TRANSITION" });
    const noNote = await t.app.inject({ method: "POST", url: `${url}/status`, headers: auth(admin), payload: { status: "IN_LEGAL_REVIEW" } });
    expect(noNote.statusCode).toBe(400);

    await t.app.inject({ method: "POST", url: `${url}/status`, headers: auth(admin), payload: { status: "IN_LEGAL_REVIEW", note: "Enviado a asesoría legal" } });
    await t.app.inject({ method: "POST", url: `${url}/notes`, headers: auth(admin), payload: { note: "Asesoría pide copia del oficio" } });
    const done = await t.app.inject({ method: "POST", url: `${url}/status`, headers: auth(admin), payload: { status: "REJECTED", note: "Sin base legal suficiente" } });
    const d = done.json() as AuthorityRequestDetail;
    expect(d).toMatchObject({ status: "REJECTED", overdue: false });
    expect(d.log.map((l) => [l.action, l.toStatus])).toEqual([["CREATED", "RECEIVED"], ["STATUS_CHANGED", "IN_LEGAL_REVIEW"], ["NOTE_ADDED", null], ["STATUS_CHANGED", "REJECTED"]]);
    expect(d.log.every((l) => l.actorUserId === admin.userId)).toBe(true);
    // Un estado final no se reabre.
    expect((await t.app.inject({ method: "POST", url: `${url}/status`, headers: auth(admin), payload: { status: "IN_LEGAL_REVIEW", note: "x" } })).statusCode).toBe(409);

    // Ni la base permite reescribir ni borrar.
    await expect(t.c.db.query(`DELETE FROM moderation.authority_requests WHERE id = $1`, [r.id])).rejects.toThrow(/no se borra/);
    await expect(t.c.db.query(`UPDATE moderation.authority_requests SET summary = 'otro' WHERE id = $1`, [r.id])).rejects.toThrow(/solo cambia el estado/);
    await expect(t.c.db.query(`UPDATE moderation.authority_request_log SET note = 'otro' WHERE request_id = $1`, [r.id])).rejects.toThrow(/solo se inserta/);

    const list = (await t.app.inject({ url: "/v1/admin/authority-requests?status=REJECTED", headers: auth(admin) })).json() as { requests: { id: string }[] };
    expect(list.requests.map((x) => x.id)).toEqual([r.id]);
  });

  it("el informe de transparencia cuenta requerimientos por tipo, con cifras chicas ocultas", async () => {
    const rep = (await t.app.inject({ url: "/v1/admin/transparency", headers: auth(admin) })).json() as TransparencyReport;
    expect(rep.authorityRequests).toEqual({ received: "<5", byType: { DATA_DISCLOSURE: "<5" } });
  });
});
