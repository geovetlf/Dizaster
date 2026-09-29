import { createPublicKey, verify } from "node:crypto";
import { evidenceSigningPayload, type EvidenceSignatureVerdict, type SubmitReportRequest } from "@dizaster/contracts";

/**
 * Verifica la firma Ed25519 de la captura (ADR 0129). NO AI REQUIRED.
 * - ABSENT: sin firma, sin dispositivo, clave no registrada para ese dispositivo, registrada después de la captura
 *   (más la tolerancia de reloj) o reemplazada antes de ella. No penaliza: solo quita la tolerancia offline.
 * - INVALID: la clave sí era la del dispositivo, pero la firma no corresponde a lo enviado, o se adjunta media cuyo
 *   hash no estaba firmado. Es lo que deja una alteración posterior a la captura.
 */
export function verifyEvidence(
  req: SubmitReportRequest,
  key: { createdAt: Date; replacedAt: Date | null } | null,
  attachedSha256: readonly string[],
  clockToleranceS: number,
): EvidenceSignatureVerdict {
  const ev = req.evidence;
  if (!ev || !req.deviceId || !key) return "ABSENT";
  const captured = Date.parse(req.capturedAt);
  if (key.createdAt.getTime() > captured + clockToleranceS * 1000) return "ABSENT";
  if (key.replacedAt && key.replacedAt.getTime() < captured) return "ABSENT";
  let ok: boolean;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: ev.publicKey }, format: "jwk" });
    ok = verify(null, Buffer.from(evidenceSigningPayload(req, ev.mediaSha256), "utf8"), publicKey, Buffer.from(ev.signature, "base64url"));
  } catch {
    ok = false;
  }
  if (!ok) return "INVALID";
  const signed = new Set(ev.mediaSha256);
  return attachedSha256.every((h) => signed.has(h)) ? "VALID" : "INVALID";
}
