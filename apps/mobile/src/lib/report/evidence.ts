import { ed25519 } from "@noble/curves/ed25519.js";
import { evidenceSigningPayload, type ReportEvidence, type SignedEvidenceFields } from "@dizaster/contracts";

/**
 * Firma de la captura en el teléfono (§8.1, §8.3, C-04; ADR 0129). Lógica común a Android e iOS: la semilla vive en
 * el almacén seguro (signing-key.ts) y aquí solo se firma. Lo firmado es lo que la captura fija (lugar, hora del fix,
 * categoría, hashes de la media); la hora de envío y "capturado offline" se deciden al enviar y no se firman.
 */
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url sin relleno (React Native no tiene Buffer). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64URL[n & 63]!;
  }
  return out;
}

export const signingPublicKey = (seed: Uint8Array): string => toBase64Url(ed25519.getPublicKey(seed));

export function signEvidence(body: SignedEvidenceFields, mediaSha256: readonly string[], seed: Uint8Array): ReportEvidence {
  const message = new TextEncoder().encode(evidenceSigningPayload(body, mediaSha256));
  return { publicKey: signingPublicKey(seed), signature: toBase64Url(ed25519.sign(message, seed)), mediaSha256: [...mediaSha256] };
}

/** Pasado este tiempo desde la captura, el envío es "capturado offline": la cola lo retuvo (§8.3). */
export const OFFLINE_AFTER_MS = 2 * 60_000;

/** Lo que se decide al enviar: la hora del reloj en ese momento y si la cola retuvo el reporte. */
export function atSendTime<T extends { capturedOffline?: boolean; presence: { deviceClock: string } }>(body: T, queuedAt: string, now: Date): T {
  const held = now.getTime() - Date.parse(queuedAt) > OFFLINE_AFTER_MS;
  return { ...body, capturedOffline: body.capturedOffline === true || held, presence: { ...body.presence, deviceClock: now.toISOString() } };
}
