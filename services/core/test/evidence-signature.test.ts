import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { evidenceSigningPayload, SubmitReportRequest } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyEvidence } from "../src/modules/report/evidence.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let u: TestUser;
let privateKey: KeyObject;
let publicKey: string;

const newKey = () => {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ format: "jwk" }).x! };
};
const registerKey = (user: TestUser, key: string, deviceId = user.deviceId) =>
  t.app.inject({ method: "PUT", url: `/v1/devices/${deviceId}/signing-key`, headers: { authorization: `Bearer ${user.token}` }, payload: { publicKey: key } });
const signed = (body: ReturnType<typeof reportBody>, key = privateKey, pub = publicKey, mediaSha256: string[] = []) => ({
  ...body,
  evidence: {
    publicKey: pub, mediaSha256,
    signature: sign(null, Buffer.from(evidenceSigningPayload(body as unknown as SubmitReportRequest, mediaSha256)), key).toString("base64url"),
  },
});
const SubmitReportRequestParse = (b: object) => SubmitReportRequest.parse(b);
const verdict = async (reportId: string) =>
  (await t.c.db.query<{ evidence_signature: string }>(`SELECT evidence_signature FROM report.reports WHERE id = $1`, [reportId])).rows[0]!.evidence_signature;
// Reporte offline enviado 20 min después de capturarlo: dentro de la tolerancia de un accidente (60 min).
const offline = (i: number) => reportBody(u, { pin: offset(LIMA, 40_000 + i * 3000), capturedAt: new Date(Date.now() - 20 * 60_000), capturedOffline: true });

beforeAll(async () => {
  t = await createTestContext();
  u = await createUser(t, "firma_offline");
  ({ privateKey, publicKey } = newKey());
  expect((await registerKey(u, publicKey)).statusCode).toBe(204);
  // La clave se registró al iniciar sesión, mucho antes de la captura.
  await t.c.db.query(`UPDATE identity.device_signing_keys SET created_at = now() - interval '1 day'`);
});
afterAll(() => t.close());

describe("firma en el dispositivo de la evidencia offline (ADR 0129)", () => {
  it("offline a tiempo y firmado: conserva la tolerancia y puede crear el evento", async () => {
    const r = await submit(t, u, signed(offline(0)));
    expect(r.body.outcome).toBe("CREATED_EVENT");
    expect(await verdict(r.body.reportId!)).toBe("VALID");
  });

  it("offline sin firma: testimonio tardío, no crea pin", async () => {
    const r = await submit(t, u, offline(1));
    expect(r.body).toMatchObject({ outcome: "DOWNGRADED_TO_POST", reasons: ["UNSIGNED_OFFLINE_EVIDENCE"] });
  });

  it("datos alterados después de firmar: firma inválida y LOW", async () => {
    const body = signed(offline(2));
    const tampered = { ...body, capturedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const r = await submit(t, u, tampered);
    expect(r.body.outcome).toBe("DOWNGRADED_TO_POST");
    expect(r.body["reasons"]).toContain("DEVICE_SIGNATURE_INVALID");
  });

  it("clave ajena al dispositivo o registrada después de la captura no cuenta", async () => {
    const other = newKey();
    const r1 = await submit(t, u, signed(offline(3), other.privateKey, other.publicKey));
    expect(await verdict((await t.c.db.query<{ id: string }>(`SELECT id FROM report.reports WHERE post_id = $1`, [r1.body.postId])).rows[0]!.id)).toBe("ABSENT");
    expect(r1.body["reasons"]).toEqual(["UNSIGNED_OFFLINE_EVIDENCE"]);

    const v = await createUser(t, "firma_tarde");
    const late = newKey();
    await registerKey(v, late.publicKey);
    const body = reportBody(v, { pin: offset(LIMA, 60_000), capturedAt: new Date(Date.now() - 20 * 60_000), capturedOffline: true });
    const r2 = await submit(t, v, signed(body, late.privateKey, late.publicKey));
    expect(r2.body["reasons"]).toEqual(["UNSIGNED_OFFLINE_EVIDENCE"]);
  });

  it("registro: idempotente, reemplazo conserva la anterior para lo ya capturado, sin reutilizar ni dispositivos ajenos", async () => {
    expect((await registerKey(u, publicKey)).statusCode).toBe(204);
    const next = newKey();
    expect((await registerKey(u, next.publicKey)).statusCode).toBe(204);
    expect((await registerKey(u, publicKey)).statusCode).toBe(409);
    // Lo capturado con la clave anterior antes del reemplazo sigue valiendo.
    const r = await submit(t, u, signed(offline(4)));
    expect(await verdict(r.body.reportId!)).toBe("VALID");
    const other = await createUser(t, "firma_ajena");
    expect((await registerKey(other, newKey().publicKey, u.deviceId)).statusCode).toBe(404);
    expect((await registerKey(u, "corta")).statusCode).toBe(400);
  });

  it("en línea la firma es opcional", async () => {
    const w = await createUser(t, "firma_en_linea");
    const plain = await submit(t, w, reportBody(w, { pin: offset(LIMA, 80_000) }));
    expect(plain.body.outcome).toBe("CREATED_EVENT");
    expect(await verdict(plain.body.reportId!)).toBe("ABSENT");
  });

  it("la media adjunta debe estar entre los hashes firmados", () => {
    const sha = "a".repeat(64);
    const body = SubmitReportRequestParse(signed(offline(9), privateKey, publicKey, [sha]));
    const key = { createdAt: new Date(Date.now() - 86_400_000), replacedAt: null };
    expect(verifyEvidence(body, key, [sha], 300)).toBe("VALID");
    expect(verifyEvidence(body, key, [sha, "b".repeat(64)], 300)).toBe("INVALID");
    expect(verifyEvidence(body, null, [sha], 300)).toBe("ABSENT");
  });
});
