import type { SubmitReportRequest } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { CATALOGS, type MessageKey } from "../src/lib/i18n";
import { outcomeLines } from "../src/lib/report/outcome";
import { MemoryQueueStorage, ReportQueue, submitStatus, type Sender } from "../src/lib/report/queue";
import { queuedReasonText, rejectionReason } from "../src/lib/report/rejection";

// Rechazos y errores definitivos de la cola de reportes (ADR 0333). NO AI REQUIRED.
const body = (id: string) => ({
  clientReportId: id, categoryCode: "FIRE", assertion: "OCCURRING", mediaIds: [], pin: { lat: -12.05, lng: -77.04 },
  presence: { deviceClock: "2026-10-11T10:00:00Z" }, capturedAt: "2026-10-11T10:00:00Z", capturedOffline: false, anonymityMode: "PUBLIC",
}) as unknown as SubmitReportRequest;
const tr = (lang: keyof typeof CATALOGS) => (k: MessageKey) => CATALOGS[lang][k];

describe("respuesta 422 REJECTED del servidor", () => {
  it("se convierte en un código de cola, no en «datos no válidos»", () => {
    expect(rejectionReason(422, { outcome: "REJECTED", code: "COUNTRY_READ_ONLY", reason: "Dizaster todavía no acepta…" })).toBe("REJECTED:COUNTRY_READ_ONLY");
    expect(rejectionReason(422, { outcome: "REJECTED", reason: "x" })).toBe("REJECTED:");
    expect(rejectionReason(422, { error: "VALIDATION" })).toBeNull();
    expect(rejectionReason(400, { outcome: "REJECTED", code: "INVALID_CATEGORY" })).toBeNull();
    expect(rejectionReason(422, null)).toBeNull();
  });

  it("se explica en el idioma de la persona, nunca con el texto en español del servidor", () => {
    for (const lang of ["es", "en", "pt", "fr"] as const) {
      const text = queuedReasonText("REJECTED:COUNTRY_READ_ONLY", tr(lang));
      expect(text, lang).toContain(CATALOGS[lang].rejected);
      expect(text, lang).toContain(CATALOGS[lang].rejected_COUNTRY_READ_ONLY);
      expect(queuedReasonText("REJECTED:FUTURE_CODE", tr(lang)), lang).toBe(CATALOGS[lang].rejected);
    }
    // Otros motivos: los de la subida se traducen y un texto ya traducido queda igual.
    expect(queuedReasonText("MEDIA_REJECTED", tr("en"))).toBe(CATALOGS.en.errMediaRejected);
    expect(queuedReasonText("Your account is suspended.", tr("en"))).toBe("Your account is suspended.");
  });

  it("outcomeLines no muestra el motivo en español fuera del español", () => {
    const r = { outcome: "REJECTED", code: "FUTURE_CODE", reason: "Motivo en español" } as never;
    expect(outcomeLines(r, tr("en"), undefined, "en")).toEqual([CATALOGS.en.rejected]);
    expect(outcomeLines(r, tr("es"), undefined, "es")).toEqual([CATALOGS.es.rejected, "Motivo en español"]);
  });
});

describe("qué se le dice a quien acaba de reportar (ADR 0333)", () => {
  it("un rechazo detiene el reporte y se informa como detenido, no como «sin conexión»", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("r1"));
    const send: Sender = async () => ({ ok: false, retryable: false, error: "REJECTED:COUNTRY_READ_ONLY" });
    const result = await q.flush(send);
    expect(submitStatus("r1", result, await q.pending())).toEqual({ kind: "stuck", reason: "REJECTED:COUNTRY_READ_ONLY" });
    // Sigue en el teléfono hasta que la persona lo reintente o descarte (ADR 0158).
    expect((await q.pending())[0]?.stuck?.reason).toBe("REJECTED:COUNTRY_READ_ONLY");
  });

  it("sin red queda en cola sin gastar intentos; con un error del servidor, reintentando", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("r2"));
    const offline = await q.flush(async () => ({ ok: false, retryable: true, error: "Sin conexión", offline: true }));
    expect(submitStatus("r2", offline, await q.pending())).toEqual({ kind: "queued", offline: true, lastError: "Sin conexión" });
    const failing = await q.flush(async () => ({ ok: false, retryable: true, error: "Mucha demanda" }));
    expect(submitStatus("r2", failing, await q.pending())).toEqual({ kind: "queued", offline: false, lastError: "Mucha demanda" });
  });

  it("enviado: devuelve la respuesta; fuera de la cola sin respuesta: nada que decir", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body("r3"));
    const response = { outcome: "CREATED_EVENT", reportId: "x", postId: "p", eventId: "e", presenceBand: "HIGH" } as never;
    const sent = await q.flush(async () => ({ ok: true, response }));
    expect(submitStatus("r3", sent, await q.pending())).toEqual({ kind: "sent", response });
    expect(submitStatus("otro", sent, await q.pending())).toBeNull();
  });
});
