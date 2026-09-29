import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { ANDROID_LOCATION, makeJpeg, makeMp4 } from "./media-fixtures.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function requestUpload(u: TestUser, file: Buffer, over: Record<string, unknown> = {}) {
  const payload = { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: sha(file), width: 1920, height: 1080, capturedInApp: true, ...over };
  return t.app.inject({ method: "POST", url: "/v1/media/uploads", headers: auth(u), payload });
}

/** Sube como lo haría el dispositivo: PUT directo a la URL firmada con las cabeceras indicadas. */
async function put(upload: { url: string; headers: Record<string, string> }, body: Buffer, headers: Record<string, string> = {}) {
  const u = new URL(upload.url);
  return t.app.inject({ method: "PUT", url: u.pathname + u.search, headers: { ...upload.headers, ...headers }, payload: body });
}

async function uploadReady(u: TestUser, file: Buffer, over: Record<string, unknown> = {}) {
  const res = await requestUpload(u, file, over);
  expect(res.statusCode).toBe(201);
  const { mediaId, upload } = res.json();
  expect((await put(upload, file)).statusCode).toBe(200);
  const done = await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
  expect(done.json().state).toBe("UPLOADED");
  await t.c.dispatcher.drain();
  return mediaId as string;
}

const state = async (u: TestUser, id: string) => (await t.app.inject({ url: `/v1/media/${id}`, headers: auth(u) })).json();

describe("subida directa firmada", () => {
  it("foto: sube, se valida, se sanea y queda lista", async () => {
    const u = await createUser(t, "media_ok");
    const id = await uploadReady(u, makeJpeg());
    expect(await state(u, id)).toMatchObject({ state: "READY", rejectionReason: null });
    const { rows } = await t.c.db.query<{ sanitized: string[]; storage_key: string }>(
      `SELECT m.sanitized, v.storage_key FROM media.media m JOIN media.variants v ON v.media_id = m.id WHERE m.id = $1`, [id],
    );
    expect(rows[0]!.sanitized).toContain("APP1 (Exif/XMP)");
    const publicCopy = Buffer.from(await t.c.storage.get(rows[0]!.storage_key));
    expect(publicCopy.includes(Buffer.from("GPSLatitude"))).toBe(false);
  });

  it("video: la ubicación del contenedor desaparece de la copia pública", async () => {
    const u = await createUser(t, "media_video");
    const file = makeMp4();
    const id = await uploadReady(u, file, { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 12_000, width: 1280, height: 720 });
    expect((await state(u, id)).state).toBe("READY");
    const { rows } = await t.c.db.query<{ storage_key: string }>(`SELECT storage_key FROM media.variants WHERE media_id = $1`, [id]);
    const copy = Buffer.from(await t.c.storage.get(rows[0]!.storage_key));
    expect(copy.length).toBe(file.length);
    expect(copy.subarray(0, copy.indexOf(Buffer.from("mdat"))).includes(Buffer.from(ANDROID_LOCATION))).toBe(false);
  });

  it("valida el pedido: tipo, tamaño y duración", async () => {
    const u = await createUser(t, "media_limits");
    expect((await requestUpload(u, makeJpeg(), { mime: "image/png" })).statusCode).toBe(400);
    expect((await requestUpload(u, makeJpeg(), { sizeBytes: 9 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await requestUpload(u, makeMp4(), { kind: "VIDEO_RECORDED", mime: "video/mp4" })).statusCode).toBe(400);
    expect((await requestUpload(u, makeMp4(), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 61_000 })).statusCode).toBe(400);
    expect((await requestUpload(u, makeJpeg(), { kind: "LIVE_STREAM" })).statusCode).toBe(400);
  });

  it("la URL firmada no admite otro tamaño, otro tipo ni firmas alteradas", async () => {
    const u = await createUser(t, "media_sig");
    const file = makeJpeg();
    const { upload } = (await requestUpload(u, file)).json();
    expect((await put(upload, Buffer.concat([file, Buffer.from("extra")]))).statusCode).toBe(403);
    expect((await put(upload, makeMp4(), { "content-type": "video/mp4" })).statusCode).toBe(403);
    expect((await put({ ...upload, url: upload.url.replace(/sig=[^&]+/, "sig=AAAA") }, file)).statusCode).toBe(403);
  });

  it("completar sin haber subido responde 409; la subida sigue pendiente", async () => {
    const u = await createUser(t, "media_missing");
    const { mediaId } = (await requestUpload(u, makeJpeg())).json();
    expect((await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) })).statusCode).toBe(409);
    expect((await state(u, mediaId)).state).toBe("PENDING_UPLOAD");
  });

  it("rechaza contenido que no coincide con el hash declarado", async () => {
    const u = await createUser(t, "media_hash");
    const real = makeJpeg();
    const other = makeJpeg({ exif: false });
    const padded = Buffer.concat([other, Buffer.alloc(real.length - other.length)]);
    const res = await requestUpload(u, real);
    const { mediaId, upload } = res.json();
    await put(upload, padded);
    await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
    await t.c.dispatcher.drain();
    expect(await state(u, mediaId)).toMatchObject({ state: "REJECTED", rejectionReason: "El hash no coincide con el declarado" });
  });

  it("rechaza un archivo que no es lo que dice ser", async () => {
    const u = await createUser(t, "media_sniff");
    const fake = Buffer.from("<html>esto no es una foto, aunque diga image/jpeg</html>");
    const id = await uploadReady(u, fake);
    expect((await state(u, id)).state).toBe("REJECTED");
  });

  it("otro usuario no ve ni completa la subida ajena", async () => {
    const a = await createUser(t, "media_owner");
    const b = await createUser(t, "media_other");
    const { mediaId } = (await requestUpload(a, makeJpeg())).json();
    expect((await t.app.inject({ url: `/v1/media/${mediaId}`, headers: auth(b) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(b) })).statusCode).toBe(404);
  });

  it("límite de subidas por hora", async () => {
    const u = await createUser(t, "media_rate");
    for (let i = 0; i < 6; i++) expect((await requestUpload(u, makeJpeg())).statusCode).toBe(201);
    expect((await requestUpload(u, makeJpeg())).statusCode).toBe(429);
  });

  it("los originales nunca se sirven por HTTP", async () => {
    const u = await createUser(t, "media_private");
    const id = await uploadReady(u, makeJpeg());
    const { rows } = await t.c.db.query<{ storage_key_original: string }>(`SELECT storage_key_original FROM media.media WHERE id = $1`, [id]);
    const res = await t.app.inject({ url: `/v1/dev-storage/${rows[0]!.storage_key_original}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("media en reportes y eventos", () => {
  it("la foto de un reporte aparece en la timeline y en la media pública del evento, saneada", async () => {
    const u = await createUser(t, "media_report");
    const id = await uploadReady(u, makeJpeg());
    const r = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.1, lng: -77.03 } }), mediaIds: [id] });
    expect(r.body.outcome).toBe("CREATED_EVENT");
    const timeline = (await t.app.inject({ url: `/v1/events/${r.body.eventId}/timeline` })).json().entries;
    expect(timeline.map((e: { type: string }) => e.type)).toContain("MEDIA_ADDED");
    const { media } = (await t.app.inject({ url: `/v1/events/${r.body.eventId}/media` })).json();
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ id, kind: "IMAGE", capturedInApp: true });
    const file = await t.app.inject({ url: new URL(media[0].url).pathname });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(JSON.stringify(media)).not.toContain("originals/");
  });

  it("una misma foto no puede adjuntarse a dos reportes", async () => {
    const u = await createUser(t, "media_twice");
    const id = await uploadReady(u, makeJpeg());
    await submit(t, u, { ...reportBody(u, { pin: { lat: -12.2, lng: -77.03 } }), mediaIds: [id] });
    const again = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.3, lng: -77.03 } }), mediaIds: [id] });
    expect(again.status).toBe(409);
  });

  it("no se adjunta media ajena ni pendiente de subir", async () => {
    const a = await createUser(t, "media_attach_a");
    const b = await createUser(t, "media_attach_b");
    const id = await uploadReady(a, makeJpeg());
    expect((await submit(t, b, { ...reportBody(b), mediaIds: [id] })).status).toBe(400);
    const { mediaId: pending } = (await requestUpload(b, makeJpeg())).json();
    expect((await submit(t, b, { ...reportBody(b), mediaIds: [pending] })).status).toBe(400);
  });

  it("en categorías sensibles la media solo se publica tras aprobación de moderación", async () => {
    const u = await createUser(t, "media_sensitive");
    const id = await uploadReady(u, makeJpeg());
    const r = await submit(t, u, { ...reportBody(u, { category: "crime.robbery", pin: { lat: -12.4, lng: -77.03 } }), mediaIds: [id] });
    expect(r.body.eventId).toBeTruthy();
    expect((await t.app.inject({ url: `/v1/events/${r.body.eventId}/media` })).json().media).toHaveLength(0);
    await t.c.db.query(`UPDATE media.media SET moderation_state = 'APPROVED' WHERE id = $1`, [id]);
    expect((await t.app.inject({ url: `/v1/events/${r.body.eventId}/media` })).json().media).toHaveLength(1);
  });
});

describe("retención (cost-first y privacidad)", () => {
  it("borra originales vencidos y subidas abandonadas; la copia pública permanece", async () => {
    const u = await createUser(t, "media_retention");
    const id = await uploadReady(u, makeJpeg());
    const { mediaId: abandoned } = (await requestUpload(u, makeJpeg())).json();
    const future = new Date(Date.now() + 31 * 24 * 3600_000);
    const res = await t.c.media.applyRetention(future);
    expect(res.originalsDeleted).toBeGreaterThanOrEqual(1);
    expect(res.abandoned).toBeGreaterThanOrEqual(1);
    const { rows } = await t.c.db.query<{ id: string; state: string; storage_key_original: string | null }>(
      `SELECT id, state, storage_key_original FROM media.media WHERE id = ANY($1)`, [[id, abandoned]],
    );
    expect(rows.find((r) => r.id === id)).toMatchObject({ state: "READY", storage_key_original: null });
    expect(rows.find((r) => r.id === abandoned)?.state).toBe("DELETED");
    const variant = await t.c.db.query<{ storage_key: string }>(`SELECT storage_key FROM media.variants WHERE media_id = $1`, [id]);
    expect(await t.c.storage.stat(variant.rows[0]!.storage_key)).not.toBeNull();
  });
});
