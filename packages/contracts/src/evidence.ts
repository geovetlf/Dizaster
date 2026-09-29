import { z } from "zod";

/**
 * Firma en el dispositivo de la evidencia de un reporte (Blueprint §8.1 "firma borrador", §8.3, C-04; ADR 0129).
 * Al capturar, la app firma con Ed25519 lo que afirma (lugar, hora del fix GNSS, categoría, hashes de la media) con
 * una clave que vive solo en el almacén seguro del teléfono y cuya parte pública registró antes en el servidor.
 * Un envío offline solo conserva su tolerancia de retraso si la firma es válida. NO AI REQUIRED.
 */

/** Clave pública Ed25519 cruda (32 bytes) en base64url sin relleno. */
export const Ed25519PublicKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** Firma Ed25519 (64 bytes) en base64url sin relleno. */
export const Ed25519Signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const RegisterSigningKeyRequest = z.object({ publicKey: Ed25519PublicKey });
export type RegisterSigningKeyRequest = z.infer<typeof RegisterSigningKeyRequest>;

export const ReportEvidence = z.object({
  publicKey: Ed25519PublicKey,
  signature: Ed25519Signature,
  /** SHA-256 de cada foto/video capturado, en el orden de captura. La media adjunta debe estar entre ellos. */
  mediaSha256: z.array(Sha256Hex).max(20).default([]),
});
export type ReportEvidence = z.infer<typeof ReportEvidence>;

/** Veredicto del servidor. ABSENT: sin firma, clave desconocida o registrada después de la captura. */
export const EvidenceSignatureVerdict = z.enum(["VALID", "INVALID", "ABSENT"]);
export type EvidenceSignatureVerdict = z.infer<typeof EvidenceSignatureVerdict>;

export const EVIDENCE_SIGNING_VERSION = "dizaster-evidence-v1";

/** Lo que se firma: los campos del reporte que la captura fija y que el envío no puede cambiar. */
export interface SignedEvidenceFields {
  clientReportId: string;
  categoryCode: string;
  assertion?: string;
  pin: { lat: number; lng: number };
  capturedAt: string;
  deviceId?: string | undefined;
  presence: { fix: { lat: number; lng: number; accuracyM: number; fixTime: string }; mockLocation: boolean | null };
}

/**
 * Texto canónico que se firma, igual en la app y en el servidor: versión y un arreglo JSON en orden fijo (los números
 * de JavaScript se serializan igual en Hermes y V8). Los hashes van ordenados para no depender del orden de subida.
 */
export function evidenceSigningPayload(r: SignedEvidenceFields, mediaSha256: readonly string[]): string {
  const f = r.presence.fix;
  return `${EVIDENCE_SIGNING_VERSION}\n${JSON.stringify([
    r.clientReportId, r.categoryCode, r.assertion ?? "OCCURRING", r.pin.lat, r.pin.lng, r.capturedAt, r.deviceId ?? null,
    f.lat, f.lng, f.accuracyM, f.fixTime, r.presence.mockLocation, [...mediaSha256].sort(),
  ])}`;
}
