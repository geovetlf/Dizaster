import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

// Pruebas de captura del medio en la evidencia de presencia (ADR 0181). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function uploadReady(u: TestUser, file: Buffer, capturedAt: string): Promise<string> {
  const payload = {
    kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update(file).digest("hex"),
    width: 1920, height: 1080, capturedInApp: true, capturedAt,
  };
  const res = await t.app.inject({ method: "POST", url: "/v1/media/uploads", headers: auth(u), payload });
  expect(res.statusCode).toBe(201);
  const { mediaId, upload } = res.json();
  const url = new URL(upload.url);
  expect((await t.app.inject({ method: "PUT", url: url.pathname + url.search, headers: upload.headers, payload: file })).statusCode).toBe(200);
  await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
  await t.c.dispatcher.drain();
  return mediaId as string;
}

describe("pruebas de captura", () => {
  it("guarda qué media de cámara acompañó al reporte y cuánto antes se tomó, junto a la presencia privada", async () => {
    const u = await createUser(t, "proofs");
    const now = new Date();
    const mediaId = await uploadReady(u, makeJpeg(), new Date(now.getTime() - 30_000).toISOString());
    const r = await submit(t, u, { ...reportBody(u, { capturedAt: now }), mediaIds: [mediaId] });
    expect(r.status).toBe(200);
    const { rows } = await t.c.db.query<{ media_capture_proofs: { mediaId: string; kind: string; secondsBeforeReport: number }[] }>(
      `SELECT media_capture_proofs FROM report.presence_evidence WHERE report_id = $1`, [r.body.reportId]);
    expect(rows[0]!.media_capture_proofs).toMatchObject([{ mediaId, kind: "IMAGE", secondsBeforeReport: 30 }]);

    // Sin media, lista vacía; y nada de esto sale por la API pública del reporte.
    const r2 = await submit(t, u, reportBody(u));
    const empty = await t.c.db.query<{ p: unknown[] }>(`SELECT media_capture_proofs AS p FROM report.presence_evidence WHERE report_id = $1`, [r2.body.reportId]);
    expect(empty.rows[0]!.p).toEqual([]);
    const pub = await t.app.inject({ url: `/v1/posts/${r.body.postId}` });
    expect(pub.body).not.toContain("secondsBeforeReport");
  });
});
