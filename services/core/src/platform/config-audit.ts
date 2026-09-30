import type { ConfigChangeKind } from "@dizaster/contracts";
import type { Queryable } from "./db.js";
import { newId } from "./ids.js";

/**
 * Historial de configuración de administración (ADR 0219). Solo inserción (trigger en la base): lo que cambió, quién,
 * cuándo, el valor anterior, el nuevo y el motivo. Guarda solo los campos de configuración, nunca datos personales.
 */
export interface ConfigChangeEntry {
  actorUserId: string;
  kind: ConfigChangeKind;
  target: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
  reason: string;
}

export async function recordConfigChange(q: Queryable, e: ConfigChangeEntry): Promise<void> {
  await q.query(
    `INSERT INTO platform.config_changes (id, actor_user_id, kind, target, previous, next, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [newId(), e.actorUserId, e.kind, e.target, e.previous === null ? null : JSON.stringify(e.previous), JSON.stringify(e.next), e.reason.trim()],
  );
}

export interface ConfigChangeRow {
  id: string; at: Date; actorUserId: string; kind: ConfigChangeKind; target: string;
  previous: Record<string, unknown> | null; next: Record<string, unknown>; reason: string;
}

/** Más recientes primero; `cursor` = id del último de la página anterior (UUIDv7, ordenado por tiempo). */
export async function listConfigChanges(q: Queryable, opts: { kind?: ConfigChangeKind; cursor?: string; limit: number }): Promise<{ rows: ConfigChangeRow[]; nextCursor: string | null }> {
  const cursor = opts.cursor && /^[0-9a-f-]{36}$/i.test(opts.cursor) ? opts.cursor : null;
  const { rows } = await q.query<{ id: string; at: Date; actor_user_id: string; kind: ConfigChangeKind; target: string; previous: Record<string, unknown> | null; next: Record<string, unknown>; reason: string }>(
    `SELECT id, at, actor_user_id, kind, target, previous, next, reason FROM platform.config_changes
      WHERE ($1::text IS NULL OR kind = $1) AND ($2::uuid IS NULL OR id < $2)
      ORDER BY id DESC LIMIT $3`,
    [opts.kind ?? null, cursor, opts.limit + 1],
  );
  const page = rows.slice(0, opts.limit);
  return {
    rows: page.map((r) => ({ id: r.id, at: r.at, actorUserId: r.actor_user_id, kind: r.kind, target: r.target, previous: r.previous, next: r.next, reason: r.reason })),
    nextCursor: rows.length > opts.limit ? page.at(-1)!.id : null,
  };
}
