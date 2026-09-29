import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

/** Media rechazada después del reporte (§6.2, ADR 0121). */
describe("MediaRejected", () => {
  let t: TestContext;
  let ana: TestUser;
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    t = await createTestContext();
    ana = await createUser(t, "ana");
  });
  afterAll(async () => t.close());

  /** Sube una foto "de la cámara" cuyo hash declarado no coincide: el worker la rechazará al procesarla. */
  async function badUpload(): Promise<string> {
    const file = makeJpeg();
    const up = await t.app.inject({
      method: "POST", url: "/v1/media/uploads", headers: auth(ana),
      payload: {
        kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update("otra cosa").digest("hex"),
        width: 64, height: 48, capturedInApp: true, capturedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    expect(up.statusCode, up.body).toBe(201);
    const { mediaId, upload } = up.json();
    const u = new URL(upload.url);
    await t.app.inject({ method: "PUT", url: u.pathname + u.search, headers: upload.headers, payload: file });
    expect((await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(ana) })).statusCode).toBe(200);
    return mediaId;
  }

  it("retira la bonificación de presencia, la foto de la línea de tiempo y del post", async () => {
    const mediaId = await badUpload();
    const res = await submit(t, ana, { ...reportBody(ana, { category: "infra.power_outage", pin: LIMA, accuracyM: 400 }), mediaIds: [mediaId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const reportId = res.body.reportId!;
    const before = (await t.c.db.query<{ presence_score: number; breakdown: { mediaInApp: number } }>(
      `SELECT r.presence_score, pe.score_breakdown AS breakdown FROM report.reports r JOIN report.presence_evidence pe ON pe.report_id = r.id WHERE r.id = $1`, [reportId],
    )).rows[0]!;
    expect(before.breakdown.mediaInApp).toBeGreaterThan(0);

    await t.c.dispatcher.drain();
    expect((await t.c.db.query<{ state: string }>(`SELECT state FROM media.media WHERE id = $1`, [mediaId])).rows[0]!.state).toBe("REJECTED");

    const after = (await t.c.db.query<{ presence_score: number; presence_band: string; breakdown: { mediaInApp: number }; reasons: string[] }>(
      `SELECT r.presence_score, r.presence_band, pe.score_breakdown AS breakdown, pe.reasons FROM report.reports r
         JOIN report.presence_evidence pe ON pe.report_id = r.id WHERE r.id = $1`, [reportId],
    )).rows[0]!;
    expect(after.breakdown.mediaInApp).toBe(0);
    expect(after.presence_score).toBeLessThan(before.presence_score);
    expect(after.reasons).toContain("MEDIA_REJECTED");
    const ev = (await t.c.db.query<{ weight: number; presence_band: string }>(
      `SELECT weight, presence_band FROM event.evidence WHERE ref_id = $1`, [reportId],
    )).rows[0]!;
    expect(ev).toEqual({ weight: after.presence_score, presence_band: after.presence_band });

    const timeline = await t.c.db.query(`SELECT 1 FROM event.timeline WHERE event_id = $1 AND type = 'MEDIA_ADDED'`, [res.body.eventId]);
    expect(timeline.rowCount).toBe(0);
    const attached = await t.c.db.query(`SELECT 1 FROM social.post_media WHERE media_id = $1`, [mediaId]);
    expect(attached.rowCount).toBe(0);

    // Idempotente: una segunda revisión no vuelve a bajar nada.
    expect(await t.c.reports.reviseForRejectedMedia(t.c.db, mediaId)).toBe(0);
  });
});
