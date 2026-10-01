import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { dctHash, hammingHex, NEAR_DUPLICATE_BITS, phashBands, redactionRects } from "../src/modules/media/images.js";
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

  it("las variantes públicas se escriben con Cache-Control acotado (ADR 0286)", async () => {
    const u = await createUser(t, "media_cache");
    const storage = t.c.storage;
    const original = storage.put.bind(storage);
    const writes: { key: string; cacheControl: string | undefined }[] = [];
    storage.put = async (key, data, mime, opts) => { writes.push({ key, cacheControl: opts?.cacheControl }); return original(key, data, mime, opts); };
    try {
      await uploadReady(u, makeJpeg());
    } finally {
      storage.put = original;
    }
    const pub = writes.filter((w) => w.key.startsWith("public/"));
    expect(pub.length).toBeGreaterThan(0);
    for (const w of pub) expect(w.cacheControl).toBe("public, max-age=3600");
    // El original privado no lleva cabecera de caché pública.
    for (const w of writes.filter((x) => !x.key.startsWith("public/"))) expect(w.cacheControl).toBeUndefined();
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

  it("video: la duración y el tamaño salen del archivo, no de lo declarado (ADR 0071)", async () => {
    const u = await createUser(t, "media_duracion");
    const honest = await uploadReady(u, makeMp4({ durationMs: 30_500, width: 1920, height: 1080 }), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 10_000, width: 640, height: 360 });
    expect(await state(u, honest)).toMatchObject({ state: "READY" });
    const dims = (await t.c.db.query(`SELECT duration_ms, width, height FROM media.media WHERE id = $1`, [honest])).rows[0];
    expect(dims).toEqual({ duration_ms: 30_500, width: 1920, height: 1080 });

    const long = await uploadReady(u, makeMp4({ durationMs: 95_000 }), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 20_000 });
    expect(await state(u, long)).toMatchObject({ state: "REJECTED" });
    expect((await state(u, long)).rejectionReason).toContain("Duración real");

    const huge = await uploadReady(u, makeMp4({ width: 7680, height: 4320 }), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 20_000 });
    expect((await state(u, huge)).rejectionReason).toContain("Resolución");
  });

  it("video: solo códecs que se reproducen sin transcodificar (ADR 0163)", async () => {
    const u = await createUser(t, "media_codec");
    const avc = await uploadReady(u, makeMp4(), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 24_000 });
    expect(await state(u, avc)).toMatchObject({ state: "READY" });
    expect((await t.c.db.query(`SELECT codec FROM media.media WHERE id = $1`, [avc])).rows[0]).toEqual({ codec: "avc1" });
    const hevc = await uploadReady(u, makeMp4({ codec: "hvc1" }), { kind: "VIDEO_RECORDED", mime: "video/quicktime", durationMs: 24_000 });
    expect(await state(u, hevc)).toMatchObject({ state: "READY" });
    for (const codec of ["mp4v", "av01", "encv", null]) {
      const id = await uploadReady(u, makeMp4({ codec }), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 24_000 });
      expect(await state(u, id)).toMatchObject({ state: "REJECTED" });
      expect((await state(u, id)).rejectionReason).toContain("Códec de video no admitido");
    }
  });

  it("video con póster del teléfono: miniatura saneada, hash perceptual y sin original del póster", async () => {
    const u = await createUser(t, "media_poster");
    const file = makeMp4();
    const poster = makeJpeg();
    const res = await requestUpload(u, file, {
      kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 8_000, width: 1280, height: 720, poster: { sizeBytes: poster.length, sha256: sha(poster) },
    });
    expect(res.statusCode).toBe(201);
    const { mediaId, upload, posterUpload } = res.json();
    expect((await put(upload, file)).statusCode).toBe(200);
    expect((await put(posterUpload, poster)).statusCode).toBe(200);
    await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
    await t.c.dispatcher.drain();

    const variants = await t.c.db.query<{ variant: string; storage_key: string }>(`SELECT variant, storage_key FROM media.variants WHERE media_id = $1 ORDER BY variant`, [mediaId]);
    expect(variants.rows.map((r) => r.variant)).toEqual(["DISPLAY", "POSTER", "THUMB_S"]);
    const posterCopy = Buffer.from(await t.c.storage.get(variants.rows[1]!.storage_key));
    expect(posterCopy.includes(Buffer.from("GPSLatitude"))).toBe(false);
    const row = (await t.c.db.query<{ phash: string | null; key: string }>(`SELECT phash, storage_key_original AS key FROM media.media WHERE id = $1`, [mediaId])).rows[0]!;
    expect(row.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(await t.c.storage.stat(`${row.key}_poster`)).toBeNull();
    const [view] = await t.c.media.publicViews(t.c.db, [mediaId], { requireApproval: false });
    expect(view).toMatchObject({ kind: "VIDEO_RECORDED", mime: "video/mp4" });
    expect(view!.posterUrl).toContain(`${mediaId}_poster.jpg`);
    expect(view!.thumbUrl).toContain(`${mediaId}_thumb_s.jpg`);
  });

  it("un póster que no llegó o no coincide no rechaza el video; solo las fotos no llevan póster", async () => {
    const u = await createUser(t, "media_poster_missing");
    const poster = makeJpeg();
    const id = await uploadReady(u, makeMp4(), {
      kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 8_000, poster: { sizeBytes: poster.length, sha256: sha(poster) },
    });
    expect((await state(u, id)).state).toBe("READY");
    const [view] = await t.c.media.publicViews(t.c.db, [id], { requireApproval: false });
    expect(view).toMatchObject({ thumbUrl: null, posterUrl: null });
    expect((await requestUpload(u, makeJpeg(), { poster: { sizeBytes: 10, sha256: sha(poster) } })).statusCode).toBe(400);
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
  it("la foto de la cámara de la app tomada junto al reporte suma a la presencia (ADR 0073)", async () => {
    const breakdown = async (reportId: unknown) => (await t.c.db.query<{ score_breakdown: Record<string, number>; rule_version: string }>(
      `SELECT score_breakdown, rule_version FROM report.presence_evidence WHERE report_id = $1`, [reportId],
    )).rows[0]!;
    const u = await createUser(t, "media_presence");
    const cam = await uploadReady(u, makeJpeg(), { capturedAt: new Date().toISOString() });
    const r = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.9, lng: -77.03 } }), mediaIds: [cam] });
    expect(await breakdown(r.body.reportId)).toMatchObject({ rule_version: "presence-4", score_breakdown: { mediaInApp: 1 } });

    const g = await createUser(t, "media_gallery");
    const gallery = await uploadReady(g, makeJpeg({ exif: false }), { capturedAt: new Date().toISOString(), capturedInApp: false });
    // D-10 (ADR 0166): en un reporte solo va media capturada con la cámara de la app; en un post, la galería sí.
    const r2 = await t.app.inject({ method: "POST", url: "/v1/reports", headers: auth(g), payload: { ...reportBody(g, { pin: { lat: -12.95, lng: -77.03 } }), mediaIds: [gallery] } });
    expect(r2.statusCode).toBe(400);
    expect(r2.json()).toMatchObject({ error: "MEDIA_NOT_CAPTURED_IN_APP" });
    const post = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(g), payload: { text: "Foto de ayer del puente", mediaIds: [gallery] } });
    expect(post.statusCode, post.body).toBe(201);
  });

  it("la foto de un reporte aparece en la timeline y en la media pública del evento, saneada", async () => {
    const u = await createUser(t, "media_report");
    const id = await uploadReady(u, makeJpeg());
    const r = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.1, lng: -77.03 } }), mediaIds: [id] });
    expect(r.body.outcome).toBe("CREATED_EVENT");
    const timeline = (await t.app.inject({ url: `/v1/events/${r.body.eventId}/timeline` })).json().entries;
    expect(timeline.map((e: { type: string }) => e.type)).toContain("MEDIA_ADDED");
    // ADR 0258: la timeline dice cuántas fotos llegaron, nunca sus ids (con un id se arma la URL pública).
    expect(timeline.find((e: { type: string }) => e.type === "MEDIA_ADDED").payload).toEqual({ mediaCount: 1 });
    expect(JSON.stringify(timeline)).not.toContain(id);
    const { media } = (await t.app.inject({ url: `/v1/events/${r.body.eventId}/media` })).json();
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ id, kind: "IMAGE", capturedInApp: true });
    const file = await t.app.inject({ url: new URL(media[0].url).pathname });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(JSON.stringify(media)).not.toContain("originals/");
  });

  it("el evento guarda la huella de fotos y palabras para deduplicar, también si la foto se procesa después", async () => {
    const u = await createUser(t, "media_huella");
    const id = await uploadReady(u, makeJpeg());
    const r = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.4, lng: -77.03 }, text: "Humo negro en el mercado central" }), mediaIds: [id] });
    const phash = (await t.c.db.query<{ phash: string }>(`SELECT phash FROM media.media WHERE id = $1`, [id])).rows[0]!.phash;
    const ev = (await t.c.db.query<{ keywords: string[]; media_hashes: string[] }>(`SELECT keywords, media_hashes FROM event.events WHERE id = $1`, [r.body.eventId])).rows[0]!;
    expect(ev.media_hashes).toEqual([phash]);
    expect(ev.keywords).toEqual(expect.arrayContaining(["humo", "mercado", "central"]));

    // Foto subida pero sin procesar al reportar: el hash llega al evento cuando termina de procesarse.
    const v = await createUser(t, "media_tarde");
    const file = makeJpeg();
    const up = (await requestUpload(v, file)).json();
    expect((await put(up.upload, file)).statusCode).toBe(200);
    await t.app.inject({ method: "POST", url: `/v1/media/${up.mediaId}/complete`, headers: auth(v) });
    const late = await submit(t, v, { ...reportBody(v, { pin: { lat: -12.6, lng: -77.03 } }), mediaIds: [up.mediaId] });
    expect((await t.c.db.query(`SELECT media_hashes FROM event.events WHERE id = $1`, [late.body.eventId])).rows[0]).toEqual({ media_hashes: [] });
    await t.c.dispatcher.drain();
    const after = (await t.c.db.query<{ media_hashes: string[] }>(`SELECT media_hashes FROM event.events WHERE id = $1`, [late.body.eventId])).rows[0]!;
    expect(after.media_hashes).toHaveLength(1);
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

describe("galería del evento (ADR 0203)", () => {
  const gallery = async (eventId: string, qs = "") => (await t.app.inject({ url: `/v1/events/${eventId}/media${qs}` })).json() as { media: { id: string }[]; nextCursor: string | null };

  it("las fotos de un reporte moderado salen de la galería y vuelven al restaurarlo", async () => {
    // Dos reportes: con uno solo, ocultarlo oculta también el evento entero.
    const [u, other] = [await createUser(t, "gal_mod"), await createUser(t, "gal_mod_2")];
    const id = await uploadReady(u, makeJpeg());
    const r = await submit(t, u, { ...reportBody(u, { pin: { lat: -12.71, lng: -77.03 } }), mediaIds: [id] });
    const eventId = r.body.eventId!;
    expect((await submit(t, other, reportBody(other, { pin: { lat: -12.7101, lng: -77.03 } }))).body.eventId).toBe(eventId);
    expect((await gallery(eventId)).media.map((m) => m.id)).toEqual([id]);
    await t.c.events.moderateEvidence(t.c.db, "CITIZEN_REPORT", r.body.reportId!, true);
    expect((await gallery(eventId)).media).toHaveLength(0);
    await t.c.events.moderateEvidence(t.c.db, "CITIZEN_REPORT", r.body.reportId!, false);
    expect((await gallery(eventId)).media.map((m) => m.id)).toEqual([id]);
  });

  it("va por páginas sin repetir fotos", async () => {
    const [a, b] = [await createUser(t, "gal_page_a"), await createUser(t, "gal_page_b")];
    const ida = await uploadReady(a, makeJpeg());
    const ra = await submit(t, a, { ...reportBody(a, { pin: { lat: -12.81, lng: -77.03 } }), mediaIds: [ida] });
    const idb = await uploadReady(b, makeJpeg());
    const rb = await submit(t, b, { ...reportBody(b, { pin: { lat: -12.8101, lng: -77.03 } }), mediaIds: [idb] });
    expect(rb.body.eventId).toBe(ra.body.eventId);
    const p1 = await gallery(ra.body.eventId!, "?limit=1");
    expect(p1.media.map((m) => m.id)).toEqual([ida]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await gallery(ra.body.eventId!, `?limit=1&cursor=${p1.nextCursor}`);
    expect(p2.media.map((m) => m.id)).toEqual([idb]);
    const p3 = await gallery(ra.body.eventId!, `?limit=1&cursor=${p2.nextCursor}`);
    expect(p3.media).toHaveLength(0);
    expect(p3.nextCursor).toBeNull();
    expect((await t.app.inject({ url: `/v1/events/${ra.body.eventId}/media?cursor=${randomUUID()}` })).statusCode).toBe(400);
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

/** Foto sintética distinta según `seed` (patrón de bloques), como JPEG real. */
async function photo(seed: number, opts: { width?: number; quality?: number } = {}): Promise<Buffer> {
  const w = 96, h = 72, px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, b = ((Math.floor(x / 12) * 7 + Math.floor(y / 12) * 13 + seed * 31) % 17) * 15;
    px[i] = b; px[i + 1] = (b * 3 + seed * 50) % 256; px[i + 2] = 255 - b;
  }
  let img = sharp(px, { raw: { width: w, height: h, channels: 3 } });
  if (opts.width) img = img.resize(opts.width);
  return img.jpeg({ quality: opts.quality ?? 85 }).toBuffer();
}

describe("miniaturas y hash perceptual", () => {
  it("genera versión de pantalla y miniatura re-codificadas, sin metadatos, y guarda tamaño y hash", async () => {
    const u = await createUser(t, "media_variants");
    const id = await uploadReady(u, makeJpeg());
    const { rows } = await t.c.db.query<{ variant: string; storage_key: string; mime: string }>(
      `SELECT variant, storage_key, mime FROM media.variants WHERE media_id = $1 ORDER BY variant`, [id],
    );
    expect(rows.map((r) => r.variant)).toEqual(["DISPLAY", "THUMB_S"]);
    for (const r of rows) {
      const data = Buffer.from(await t.c.storage.get(r.storage_key));
      for (const secret of ["GPSLatitude", "comentario", "ICC_PROFILE", "Exif"]) expect(data.includes(Buffer.from(secret)), `${r.variant}: ${secret}`).toBe(false);
      const meta = await sharp(data).metadata();
      expect(meta.format).toBe("jpeg");
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(r.variant === "THUMB_S" ? 400 : 1600);
    }
    const m = (await t.c.db.query(`SELECT width, height, phash, array_length(phash_bands, 1) AS bands FROM media.media WHERE id = $1`, [id])).rows[0];
    expect(m).toMatchObject({ width: 64, height: 48, bands: 8 });
    expect(m.phash).toMatch(/^[0-9a-f]{16}$/);
    const [view] = await t.c.media.publicViews(t.c.db, [id], { requireApproval: false });
    expect(view!.thumbUrl).toMatch(/_thumb_s\.jpg$/);
    expect(view!.url).toMatch(/\.jpg$/);
  });

  it("rechaza un JPEG que no se puede decodificar", async () => {
    const u = await createUser(t, "media_broken");
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x01, 0x02, 0xff, 0xda, 0x00, 0x02]), Buffer.alloc(64, 7), Buffer.from([0xff, 0xd9])]);
    const res = await requestUpload(u, broken);
    const { mediaId, upload } = res.json();
    await put(upload, broken);
    await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
    await t.c.dispatcher.drain();
    expect(await state(u, mediaId)).toMatchObject({ state: "REJECTED" });
  });

  it("el hash tolera recompresión y reescalado, y distingue fotos distintas", async () => {
    const gray = async (b: Buffer) => sharp(b).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer();
    const a = dctHash(await gray(await photo(1)));
    const a2 = dctHash(await gray(await photo(1, { width: 60, quality: 40 })));
    const b = dctHash(await gray(await photo(2)));
    expect(hammingHex(a, a2)).toBeLessThanOrEqual(NEAR_DUPLICATE_BITS);
    expect(hammingHex(a, b)).toBeGreaterThan(NEAR_DUPLICATE_BITS);
    expect(phashBands("00ff000000000000").slice(0, 2)).toEqual([0, 256 + 255]);
  });

  it("una foto reciclada de otra persona se marca y moderación la revisa; la propia o la distinta no", async () => {
    const a = await createUser(t, "foto_original");
    const b = await createUser(t, "foto_reciclada");
    const original = await uploadReady(a, await photo(5), { width: 96, height: 72 });
    await t.c.db.query(`UPDATE media.media SET created_at = now() - interval '2 days' WHERE id = $1`, [original]);
    const mine = await uploadReady(a, await photo(5, { quality: 50 }), { width: 96, height: 72 });
    const copy = await uploadReady(b, await photo(5, { width: 80, quality: 45 }), { width: 80, height: 60 });
    const other = await uploadReady(b, await photo(9), { width: 96, height: 72 });
    const rows = new Map((await t.c.db.query<{ id: string; duplicate_of: string | null; reuse_suspected: boolean }>(
      `SELECT id, duplicate_of, reuse_suspected FROM media.media WHERE id = ANY($1)`, [[mine, copy, other]],
    )).rows.map((r) => [r.id, r]));
    expect(rows.get(mine)).toMatchObject({ duplicate_of: original, reuse_suspected: false });
    expect(rows.get(copy)).toMatchObject({ duplicate_of: original, reuse_suspected: true });
    expect(rows.get(other)).toMatchObject({ duplicate_of: null, reuse_suspected: false });

    const r = await submit(t, b, { ...reportBody(b, { pin: { lat: -12.45, lng: -77.02 } }), mediaIds: [copy] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await t.c.dispatcher.drain();
    const flags = (await t.c.db.query<{ reason: string; note: string }>(
      `SELECT f.reason, f.note FROM moderation.flags f JOIN social.post_media pm ON pm.post_id = f.target_id WHERE pm.media_id = $1`, [copy],
    )).rows;
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ reason: "FALSE_INFO" });
  });
});

describe("difuminado de rostros y matrículas (ADR 0042)", () => {
  /** Tablero de ajedrez fino: mucho detalle que el difuminado debe borrar. */
  async function checker(): Promise<Buffer> {
    const w = 200, h = 100, px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.fill(((x >> 2) + (y >> 2)) % 2 ? 255 : 0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  }
  /** Desviación típica del gris en un recuadro: alta con detalle, baja cuando está difuminado. */
  async function contrast(img: Buffer, r: { left: number; top: number; width: number; height: number }) {
    const g = await sharp(img).extract(r).greyscale().raw().toBuffer();
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    return Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  }

  it("convierte recuadros normalizados en píxeles dentro de la foto", () => {
    expect(redactionRects([{ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }], 200, 100)).toEqual([{ left: 100, top: 50, width: 50, height: 50 }]);
    expect(redactionRects([{ x: 0.99, y: 0.99, w: 0.01, h: 0.01 }], 200, 100)[0]).toMatchObject({ width: 2, height: 1 });
  });

  it("difumina solo dentro del recuadro en todas las variantes públicas", async () => {
    const u = await createUser(t, "media_redact");
    const file = await checker();
    const id = await uploadReady(u, file, { width: 200, height: 100, redactions: [{ x: 0, y: 0, w: 0.5, h: 1 }] });
    const { rows } = await t.c.db.query<{ variant: string; storage_key: string }>(`SELECT variant, storage_key FROM media.variants WHERE media_id = $1`, [id]);
    const display = Buffer.from(await t.c.storage.get(rows.find((r) => r.variant === "DISPLAY")!.storage_key));
    const inside = await contrast(display, { left: 10, top: 10, width: 60, height: 60 });
    const outside = await contrast(display, { left: 130, top: 10, width: 60, height: 60 });
    expect(outside).toBeGreaterThan(80);
    expect(inside).toBeLessThan(outside / 4);
    // El hash perceptual sale del original: una foto reciclada sin difuminar se sigue detectando.
    const { rows: [m] } = await t.c.db.query<{ phash: string }>(`SELECT phash FROM media.media WHERE id = $1`, [id]);
    const gray = await sharp(file).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer();
    expect(m!.phash).toBe(dctHash(gray));
  });

  it("no acepta difuminado en videos ni recuadros fuera de la foto", async () => {
    const u = await createUser(t, "media_redact_bad");
    const video = await requestUpload(u, makeMp4(), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 1000, redactions: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    expect(video.statusCode).toBe(400);
    const out = await requestUpload(u, await checker(), { redactions: [{ x: 0.8, y: 0, w: 0.5, h: 0.1 }] });
    expect(out.statusCode).toBe(400);
  });
});

describe("original privado para moderación (ADR 0168)", () => {
  it("con motivo, enlace de 60 s, sin metadatos y registrado; un ciudadano no puede", async () => {
    const u = await createUser(t, "media_original_autor");
    const file = makeJpeg();
    const id = await uploadReady(u, file);
    const m = await createUser(t, "mod_original");
    await t.c.identity.grantRole(m.userId, "moderator");
    const mod = { ...m, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_original", platform: "ANDROID", deviceId: m.deviceId } })).json().token as string };

    const ask = (who: TestUser, reason: string) => t.app.inject({ method: "POST", url: `/v1/moderation/media/${id}/original`, headers: auth(who), payload: { reason } });
    expect((await ask(u, "quiero verlo")).statusCode).toBe(403);
    expect((await ask(mod, "x")).statusCode).toBe(400);
    const grant = await ask(mod, "Denuncia de montaje: revisar zona difuminada");
    expect(grant.statusCode, grant.body).toBe(200);
    const { path, mime } = grant.json() as { path: string; mime: string };
    expect(mime).toBe("image/jpeg");

    const got = await t.app.inject({ url: path });
    expect(got.statusCode).toBe(200);
    expect(got.headers["cache-control"]).toContain("no-store");
    expect(got.rawPayload.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(got.rawPayload.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect((await t.app.inject({ url: "/v1/moderation/media-originals/" + "a".repeat(32) })).statusCode).toBe(404);

    const log = (await t.c.media.originalAccessLog({ mediaId: id, limit: 10 })).entries;
    expect(log[0]).toMatchObject({ mediaId: id, actorUserId: mod.userId, reason: "Denuncia de montaje: revisar zona difuminada" });
    await expect(t.c.db.query(`UPDATE media.original_access_log SET reason = 'otro'`)).rejects.toThrow(/solo se inserta/);
    // Vencido: el mismo enlace ya no sirve.
    await t.c.db.query(`ALTER TABLE media.original_access_log DISABLE TRIGGER original_access_append_only`);
    await t.c.db.query(`UPDATE media.original_access_log SET expires_at = now() - interval '1 second'`);
    await t.c.db.query(`ALTER TABLE media.original_access_log ENABLE TRIGGER original_access_append_only`);
    expect((await t.app.inject({ url: path })).statusCode).toBe(404);
  });
});
