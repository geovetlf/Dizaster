import {
  AddAuthorityRequestNote,
  AUTHORITY_REQUEST_FINAL,
  AUTHORITY_REQUEST_TRANSITIONS,
  AuthorityRequestListQuery,
  ChangeAuthorityRequestStatus,
  CreateAuthorityRequest,
  type AuthorityRequestChannel,
  type AuthorityRequestDetail,
  type AuthorityRequestLogEntry,
  type AuthorityRequestStatus,
  type AuthorityRequestSummary,
  type AuthorityRequestType,
} from "@dizaster/contracts";
import { z } from "zod";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";

interface Row {
  id: string; authority: string; country: string; jurisdiction: string | null; external_reference: string | null;
  type: AuthorityRequestType; channel: AuthorityRequestChannel; legal_basis: string | null; received_at: Date; due_at: Date | null;
  subject_refs: string[]; summary: string; status: AuthorityRequestStatus; created_at: Date;
}

/**
 * Registro auditado de requerimientos de autoridades (ADR 0139). Solo administración. Guarda qué llegó y cómo se
 * tramitó; NO entrega ni exporta datos de nadie (decisión del propietario: sin procedimiento de entrega hasta contar
 * con asesoría legal). El requerimiento no se borra y cada paso queda en un log de solo inserción. NO AI REQUIRED.
 */
export class AuthorityRequestRegister {
  constructor(private readonly db: Db, private readonly now: () => Date) {}

  async create(raw: unknown, actorUserId: string): Promise<AuthorityRequestDetail> {
    const r = parse(CreateAuthorityRequest, raw);
    if (r.dueAt && Date.parse(r.dueAt) < Date.parse(r.receivedAt)) throw new DomainError("VALIDATION", "dueAt: anterior a receivedAt");
    if (Date.parse(r.receivedAt) > this.now().getTime() + 5 * 60_000) throw new DomainError("VALIDATION", "receivedAt: en el futuro");
    const id = newId();
    await withTransaction(this.db, async (tx) => {
      await tx.query(
        `INSERT INTO moderation.authority_requests (id, authority, country, jurisdiction, external_reference, type, channel, legal_basis,
           received_at, due_at, subject_refs, summary, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, r.authority, r.country, r.jurisdiction ?? null, r.externalReference ?? null, r.type, r.channel, r.legalBasis ?? null,
          r.receivedAt, r.dueAt ?? null, [...new Set(r.subjectRefs)], r.summary, actorUserId],
      );
      await this.log(tx, id, actorUserId, "CREATED", null, "RECEIVED", null);
    });
    return this.detail(id);
  }

  async list(rawQuery: unknown): Promise<{ requests: AuthorityRequestSummary[] }> {
    const q = parse(AuthorityRequestListQuery, rawQuery ?? {});
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM moderation.authority_requests WHERE ($1::text IS NULL OR status = $1)
        ORDER BY (status IN ('ANSWERED','REJECTED','WITHDRAWN')), due_at NULLS LAST, received_at DESC LIMIT $2`,
      [q.status ?? null, q.limit],
    );
    return { requests: rows.map((r) => this.summary(r)) };
  }

  async detail(id: string): Promise<AuthorityRequestDetail> {
    if (!z.uuid().safeParse(id).success) throw notFound("Requerimiento");
    const r = (await this.db.query<Row>(`SELECT * FROM moderation.authority_requests WHERE id = $1`, [id])).rows[0];
    if (!r) throw notFound("Requerimiento");
    const log = (await this.db.query<{ at: Date; actor_user_id: string | null; action: AuthorityRequestLogEntry["action"]; from_status: AuthorityRequestStatus | null; to_status: AuthorityRequestStatus | null; note: string | null }>(
      `SELECT at, actor_user_id, action, from_status, to_status, note FROM moderation.authority_request_log WHERE request_id = $1 ORDER BY at, id`, [id])).rows;
    return {
      ...this.summary(r),
      jurisdiction: r.jurisdiction,
      externalReference: r.external_reference,
      channel: r.channel,
      legalBasis: r.legal_basis,
      subjectRefs: r.subject_refs,
      summary: r.summary,
      createdAt: r.created_at.toISOString(),
      log: log.map((l) => ({ at: l.at.toISOString(), actorUserId: l.actor_user_id, action: l.action, fromStatus: l.from_status, toStatus: l.to_status, note: l.note })),
    };
  }

  /** Cambio de estado con nota obligatoria. Los estados finales no se reabren. */
  async changeStatus(id: string, raw: unknown, actorUserId: string): Promise<AuthorityRequestDetail> {
    const c = parse(ChangeAuthorityRequestStatus, raw);
    await this.detail(id);
    await withTransaction(this.db, async (tx) => {
      const cur = (await tx.query<{ status: AuthorityRequestStatus }>(`SELECT status FROM moderation.authority_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0]!;
      if (!AUTHORITY_REQUEST_TRANSITIONS[cur.status].includes(c.status)) {
        throw new DomainError("AUTHORITY_REQUEST_TRANSITION", `No se puede pasar de ${cur.status} a ${c.status}`, 409);
      }
      await tx.query(`UPDATE moderation.authority_requests SET status = $2, updated_at = now() WHERE id = $1`, [id, c.status]);
      await this.log(tx, id, actorUserId, "STATUS_CHANGED", cur.status, c.status, c.note);
    });
    return this.detail(id);
  }

  async addNote(id: string, raw: unknown, actorUserId: string): Promise<AuthorityRequestDetail> {
    const n = parse(AddAuthorityRequestNote, raw);
    await this.detail(id);
    await this.log(this.db, id, actorUserId, "NOTE_ADDED", null, null, n.note);
    return this.detail(id);
  }

  private summary(r: Row): AuthorityRequestSummary {
    return {
      id: r.id,
      authority: r.authority,
      country: r.country,
      type: r.type,
      status: r.status,
      receivedAt: r.received_at.toISOString(),
      dueAt: r.due_at?.toISOString() ?? null,
      overdue: !!r.due_at && r.due_at.getTime() < this.now().getTime() && !AUTHORITY_REQUEST_FINAL.includes(r.status),
    };
  }

  private async log(q: Queryable, id: string, actor: string, action: AuthorityRequestLogEntry["action"], from: AuthorityRequestStatus | null, to: AuthorityRequestStatus | null, note: string | null) {
    await q.query(
      `INSERT INTO moderation.authority_request_log (id, request_id, actor_user_id, action, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId(), id, actor, action, from, to, note],
    );
  }
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}
