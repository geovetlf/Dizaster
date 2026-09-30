import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Qué se sabe de un artefacto (Blueprint §20.11). Sin esto no se despliega. */
export interface ArtifactManifest {
  name: string;
  version: string;
  commit: string;
  builtAt: string;
  digest: string;
  sbomDigest?: string | undefined;
  buildEnv: { node: string; pnpm?: string | undefined; runner?: string | undefined };
  tests: "passed" | "failed" | "skipped";
  security: "passed" | "failed" | "skipped";
  provenance?: string | undefined;
}

export const sha256File = (path: string): string => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

/**
 * "Nunca desplegar un artefacto cuyo origen no pueda determinarse": el digest debe coincidir con el manifiesto, el
 * commit debe ser un SHA completo y pruebas y seguridad deben haber pasado. La firma (cosign keyless en CI) es una
 * verificación adicional, no un sustituto de esta.
 */
export function verifyManifest(m: ArtifactManifest, actualDigest: string): string[] {
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(m.commit)) problems.push("commit no es un SHA completo");
  if (!/^sha256:[0-9a-f]{64}$/.test(m.digest)) problems.push("digest con formato inválido");
  if (m.digest !== actualDigest) problems.push(`el digest no coincide (manifiesto ${m.digest}, real ${actualDigest})`);
  if (m.tests !== "passed") problems.push(`pruebas: ${m.tests}`);
  if (m.security !== "passed") problems.push(`seguridad: ${m.security}`);
  if (Number.isNaN(Date.parse(m.builtAt))) problems.push("fecha de build inválida");
  return problems;
}
