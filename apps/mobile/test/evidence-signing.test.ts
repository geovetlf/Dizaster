import { createPublicKey, verify } from "node:crypto";
import { evidenceSigningPayload, ReportEvidence } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { atSendTime, signEvidence, signingPublicKey, toBase64Url } from "../src/lib/report/evidence";
import { MemoryQueueStorage, ReportQueue } from "../src/lib/report/queue";

const seed = new Uint8Array(32).map((_, i) => i + 1);
const body = {
  clientReportId: "0192f0a0-0000-7000-8000-000000000001",
  categoryCode: "accident.traffic",
  assertion: "OCCURRING" as const,
  mediaIds: [],
  pin: { lat: -12.0464, lng: -77.0428 },
  presence: {
    fix: { lat: -12.0465, lng: -77.0427, accuracyM: 8, fixTime: "2026-09-29T10:00:00.000Z", provider: "GNSS" as const },
    mockLocation: false, attestationToken: null, recentFixes: [], deviceClock: "2026-09-29T10:00:01.000Z",
  },
  capturedAt: "2026-09-29T10:00:00.000Z",
  capturedOffline: false,
  anonymityMode: "PUBLIC" as const,
  deviceId: "0192f0a0-0000-7000-8000-0000000000aa",
};

describe("firma de la evidencia en el teléfono (ADR 0129)", () => {
  it("base64url sin relleno", () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(toBase64Url(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });

  it("la firma de noble la verifica el Ed25519 de Node (lo que usa el servidor)", () => {
    const sha = ["b".repeat(64), "a".repeat(64)];
    const ev = ReportEvidence.parse(signEvidence(body, sha, seed));
    expect(ev.publicKey).toBe(signingPublicKey(seed));
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: ev.publicKey }, format: "jwk" });
    const ok = (b: typeof body) => verify(null, Buffer.from(evidenceSigningPayload(b, ev.mediaSha256)), key, Buffer.from(ev.signature, "base64url"));
    expect(ok(body)).toBe(true);
    expect(ok({ ...body, pin: { lat: -12.05, lng: -77.0428 } })).toBe(false);
    // La hora de envío y "capturado offline" no se firman: la cola puede fijarlos al enviar.
    expect(ok(atSendTime(body, "2026-09-29T10:00:01.000Z", new Date("2026-09-29T13:00:00Z")))).toBe(true);
  });

  it("al enviar: reloj actual y 'capturado offline' si la cola lo retuvo más de 2 min", () => {
    const quick = atSendTime(body, "2026-09-29T10:00:01.000Z", new Date("2026-09-29T10:00:30Z"));
    expect(quick.capturedOffline).toBe(false);
    expect(quick.presence.deviceClock).toBe("2026-09-29T10:00:30.000Z");
    expect(atSendTime(body, "2026-09-29T10:00:01.000Z", new Date("2026-09-29T11:00:00Z")).capturedOffline).toBe(true);
  });

  it("la cola aplica la hora de envío a cada reporte", async () => {
    const q = new ReportQueue(new MemoryQueueStorage());
    await q.enqueue(body, new Date("2026-09-29T10:00:01Z"));
    const sent: (typeof body)[] = [];
    await q.flush(async (b) => { sent.push(b as typeof body); return { ok: true, response: { outcome: "DOWNGRADED_TO_POST", postId: body.clientReportId, reasons: [] } }; },
      undefined, undefined, () => new Date("2026-09-29T12:00:00Z"));
    expect(sent[0]).toMatchObject({ capturedOffline: true, presence: { deviceClock: "2026-09-29T12:00:00.000Z" } });
  });
});
