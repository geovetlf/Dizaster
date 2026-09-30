import type { SubmitReportRequest } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import type { LocalMedia } from "../src/lib/media/local-media";
import { MemoryQueueStorage, ReportQueue, type Sender } from "../src/lib/report/queue";

// ADR 0245: descartar un reporte mientras se envía no lo publica ni lo resucita.
const body = (id: string) => ({ clientReportId: id, categoryCode: "accident.traffic" }) as unknown as SubmitReportRequest;
const photo = { localUri: "file:///a.jpg", kind: "IMAGE", mime: "image/jpeg", sizeBytes: 10, sha256: "a".repeat(64), width: 1, height: 1 } as LocalMedia;

describe("descartar durante un envío", () => {
  it("descartado mientras sube la foto: no se envía ni vuelve a la cola", async () => {
    const storage = new MemoryQueueStorage();
    const q = new ReportQueue(storage);
    await q.enqueue(body("r-1"), new Date(), [photo]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let sends = 0;
    const send: Sender = async () => { sends++; return { ok: true, response: {} as never }; };
    const flushing = q.flush(send, async () => { await gate; return { ok: true, mediaId: "m-1" }; });
    await new Promise((r) => setTimeout(r, 0));
    await q.discard("r-1");
    release();
    await flushing;
    expect(sends).toBe(0);
    expect(await q.pending()).toEqual([]);
  });

  it("descartado mientras falla sin red: no resucita", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("r-2"));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const flushing = q.flush(async () => { await gate; return { ok: false, retryable: true, error: "NETWORK", offline: true }; });
    await new Promise((r) => setTimeout(r, 0));
    await q.discard("r-2");
    release();
    await flushing;
    expect(await q.pending()).toEqual([]);
  });

  it("sin descartar, el envío sigue igual", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("r-3"));
    const r = await q.flush(async () => ({ ok: true, response: { outcome: "CREATED_EVENT" } as never }));
    expect(r.sent).toHaveLength(1);
  });
});
