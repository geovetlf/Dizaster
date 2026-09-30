import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** Quién inició la acción (Blueprint §20.20). */
export type Actor = "human" | "claude" | "schedule" | "delivery-plane";

export interface AuditInput {
  actor: Actor;
  action: string;
  environment: "development" | "staging" | "production" | "none";
  commit?: string | undefined;
  ref?: string | undefined;
  runId?: string | undefined;
  decision?: string | undefined;
  reasons?: string[] | undefined;
  artifactDigest?: string | undefined;
  result?: "ok" | "failed" | "blocked" | "rolled-back" | undefined;
  approvedBy?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface AuditRecord extends AuditInput { id: string; at: string; prevHash: string; hash: string }

/** JSON canónico: claves ordenadas, para que el hash no dependa del orden de escritura. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const GENESIS = "0".repeat(64);

export function readLog(path: string): AuditRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditRecord);
}

/**
 * Registro append-only encadenado (Audit Engine): cada entrada guarda el hash de la anterior, así que borrar, cambiar
 * o reordenar una entrada rompe la cadena. En la nube el archivo vive en un bucket con retención; aquí es un JSONL.
 */
export function appendAudit(path: string, input: AuditInput, now = new Date()): AuditRecord {
  const log = readLog(path);
  const prevHash = log.at(-1)?.hash ?? GENESIS;
  const body = { ...input, id: randomUUID(), at: now.toISOString(), prevHash };
  const rec: AuditRecord = { ...body, hash: sha256(canonical(body)) };
  appendFileSync(path, `${JSON.stringify(rec)}\n`);
  return rec;
}

export function verifyLog(records: AuditRecord[]): { ok: true } | { ok: false; index: number; problem: string } {
  let prev = GENESIS;
  for (const [i, r] of records.entries()) {
    const { hash, ...body } = r;
    if (r.prevHash !== prev) return { ok: false, index: i, problem: "la cadena no enlaza con la entrada anterior" };
    if (sha256(canonical(body)) !== hash) return { ok: false, index: i, problem: "el contenido no coincide con su hash" };
    prev = hash;
  }
  return { ok: true };
}
