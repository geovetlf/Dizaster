import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Revision } from "./deploy.js";

/**
 * Registro de versiones desplegadas por entorno (Blueprint §20.15): para volver atrás hace falta saber qué digest,
 * qué configuración y qué migración tenía la versión anterior. JSONL append-only; en la nube vive junto a la auditoría.
 */
export interface ReleaseRecord {
  env: "staging" | "production";
  service: string;
  revision: Revision;
  outcome: "deployed" | "rejected" | "rolled-back" | "rollback" | "dry-run";
  previous: Revision | null;
  /** sha256 del archivo de configuración no secreta usado (tfvars o env), si se dio. */
  configSha?: string | undefined;
  /** Última migración incluida en la imagen: la versión anterior es compatible con el esquema hasta aquí. */
  migration?: string | undefined;
  at: string;
  actor: string;
}

export function readReleases(path: string): ReleaseRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ReleaseRecord);
}

export function appendRelease(path: string, rec: ReleaseRecord): void {
  appendFileSync(path, `${JSON.stringify(rec)}\n`);
}

/** Última versión que quedó sirviendo en el entorno (desplegada o restaurada por rollback). */
export function lastServing(records: ReleaseRecord[], env: string, service: string): ReleaseRecord | null {
  return records.filter((r) => r.env === env && r.service === service && (r.outcome === "deployed" || r.outcome === "rollback")).at(-1) ?? null;
}

/**
 * Destino del rollback: la versión servida antes de la actual. Se busca la última desplegada cuyo digest difiere del
 * que sirve ahora, para que dos rollbacks seguidos no se queden en la misma versión.
 */
export function rollbackCandidate(records: ReleaseRecord[], env: string, service: string): ReleaseRecord | null {
  const serving = lastServing(records, env, service);
  if (!serving) return null;
  const earlier = records.filter((r) => r.env === env && r.service === service && r.outcome === "deployed" && r.revision.digest !== serving.revision.digest);
  return earlier.at(-1) ?? null;
}

/**
 * Promoción a producción (Blueprint §20.13): solo el mismo digest que ya quedó desplegado y verificado en staging.
 * Nunca se reconstruye para producción.
 */
export function promotable(records: ReleaseRecord[], service: string, digest: string): boolean {
  return records.some((r) => r.env === "staging" && r.service === service && r.outcome === "deployed" && r.revision.digest === digest);
}
