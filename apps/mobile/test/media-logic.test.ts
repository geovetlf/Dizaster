import { createHash } from "node:crypto";
import { SubmitReportRequest } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { checkLimits, fitWithin, sha256OfChunks, toUploadRequest, videoMime, type LocalMedia } from "../src/lib/media/local-media";
import { MemoryQueueStorage, ReportQueue, type MediaUploader } from "../src/lib/report/queue";

async function* chunks(buf: Buffer, size: number) {
  for (let i = 0; i < buf.length; i += size) yield new Uint8Array(buf.subarray(i, i + size));
}

const photo = (n: number): LocalMedia => ({
  localUri: `file:///doc/pending-media/${n}.jpg`, kind: "IMAGE", mime: "image/jpeg", sizeBytes: 1000 + n, sha256: "a".repeat(64),
  width: 1920, height: 1080, durationMs: null, capturedInApp: true, capturedAt: "2026-09-29T10:00:00.000Z",
});

const report = (id: string) => SubmitReportRequest.parse({
  clientReportId: id, categoryCode: "accident.traffic", pin: { lat: -12.05, lng: -77.04 },
  presence: { fix: { lat: -12.05, lng: -77.04, accuracyM: 6, fixTime: "2026-09-29T10:00:00Z", provider: "GNSS" }, mockLocation: false, attestationToken: null, recentFixes: [], deviceClock: "2026-09-29T10:00:00Z" },
  capturedAt: "2026-09-29T10:00:00Z",
});

describe("preparación de media en el dispositivo", () => {
  it("el hash por bloques coincide con el de todo el archivo", async () => {
    const data = Buffer.alloc(1_000_003, 7);
    const r = await sha256OfChunks(chunks(data, 256 * 1024));
    expect(r).toEqual({ hex: createHash("sha256").update(data).digest("hex"), size: data.length });
  });

  it("reduce fotos grandes manteniendo proporción y deja las pequeñas", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1440, height: 1920 });
    expect(fitWithin(1280, 720)).toBeNull();
  });

  it("identifica MOV de iOS y MP4 de Android", () => {
    expect(videoMime("file:///x/IMG_0001.MOV")).toBe("video/quicktime");
    expect(videoMime("file:///x/VID_2026.mp4", "video/mp4")).toBe("video/mp4");
    expect(videoMime("content://media/123", "video/quicktime")).toBe("video/quicktime");
  });

  it("aplica los mismos límites que el servidor", () => {
    expect(checkLimits(photo(1))).toBeNull();
    expect(checkLimits({ ...photo(1), sizeBytes: 9 * 1024 * 1024 })).toBe("tooLarge");
    expect(checkLimits({ kind: "VIDEO_RECORDED", mime: "video/mp4", sizeBytes: 1000, durationMs: 61_000 })).toBe("tooLong");
    expect(checkLimits({ kind: "VIDEO_RECORDED", mime: "video/webm", sizeBytes: 1000, durationMs: 1000 })).toBe("unsupportedType");
  });

  it("la petición de subida no lleva la ruta local del archivo", () => {
    const req = toUploadRequest(photo(1));
    expect(JSON.stringify(req)).not.toContain("file://");
    expect(req).toMatchObject({ kind: "IMAGE", mime: "image/jpeg", capturedInApp: true });
  });
});

describe("cola offline con fotos", () => {
  const ok = { ok: true as const, response: { outcome: "CREATED_EVENT" as const, reportId: "r", postId: "p", eventId: "e", presenceBand: "HIGH" as const } };

  it("sube la media antes del reporte y no repite lo ya subido al reintentar", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(report("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f90"), new Date(), [photo(1), photo(2)]);
    const uploads: string[] = [];
    let networkUp = false;
    const upload: MediaUploader = async (m) => {
      uploads.push(m.localUri);
      if (m.localUri.endsWith("2.jpg") && !networkUp) return { ok: false, retryable: true, error: "offline" };
      return { ok: true, mediaId: `m-${m.localUri.slice(-5, -4)}` };
    };
    let sentBody: { mediaIds: string[] } | null = null;
    const send = async (b: { mediaIds: string[] }) => { sentBody = b; return ok; };

    expect(await q.flush(send, upload)).toMatchObject({ failed: 1 });
    expect(sentBody).toBeNull();
    networkUp = true;
    const done: string[] = [];
    expect(await q.flush(send, upload, (i) => done.push(i.clientReportId))).toMatchObject({ sent: [ok.response] });
    expect(uploads.filter((u) => u.endsWith("1.jpg"))).toHaveLength(1);
    expect(sentBody!.mediaIds).toEqual(["m-1", "m-2"]);
    expect(done).toHaveLength(1);
  });

  it("una foto rechazada no impide que el reporte llegue", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(report("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f91"), new Date(), [photo(1), photo(2)]);
    let sentIds: string[] = [];
    const res = await q.flush(
      async (b) => { sentIds = b.mediaIds; return ok; },
      async (m) => (m.localUri.endsWith("1.jpg") ? { ok: false, retryable: false, error: "rechazada" } : { ok: true, mediaId: "m-2" }),
    );
    expect(res.sent).toHaveLength(1);
    expect(sentIds).toEqual(["m-2"]);
  });

  it("reportes antiguos guardados sin media siguen funcionando", async () => {
    const storage = new MemoryQueueStorage();
    const body = report("01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f92");
    await storage.put({ clientReportId: body.clientReportId, body, attempts: 0, lastError: null, createdAt: new Date().toISOString() });
    const res = await new ReportQueue(storage).flush(async () => ok);
    expect(res.sent).toHaveLength(1);
  });
});
