import { z } from "zod";
import { CountryCode, Instant } from "./common.js";

/**
 * Registro auditado de requerimientos de autoridades (ADR 0139). SOLO registro: qué llegó, de quién, qué pide, en
 * qué estado está y quién hizo qué. Por decisión del propietario NO existe procedimiento de entrega de datos: ninguna
 * ruta exporta información de personas a partir de un requerimiento hasta contar con asesoría legal. NO AI REQUIRED.
 */
export const AUTHORITY_REQUEST_TYPES = ["DATA_DISCLOSURE", "DATA_PRESERVATION", "CONTENT_REMOVAL", "EMERGENCY_DISCLOSURE", "OTHER"] as const;
export const AuthorityRequestType = z.enum(AUTHORITY_REQUEST_TYPES);
export type AuthorityRequestType = z.infer<typeof AuthorityRequestType>;

export const AUTHORITY_REQUEST_CHANNELS = ["EMAIL", "POSTAL", "PORTAL", "IN_PERSON", "OTHER"] as const;
export const AuthorityRequestChannel = z.enum(AUTHORITY_REQUEST_CHANNELS);
export type AuthorityRequestChannel = z.infer<typeof AuthorityRequestChannel>;

/** RECEIVED → IN_LEGAL_REVIEW → ANSWERED | REJECTED | WITHDRAWN. Los tres últimos son finales. */
export const AUTHORITY_REQUEST_STATUSES = ["RECEIVED", "IN_LEGAL_REVIEW", "ANSWERED", "REJECTED", "WITHDRAWN"] as const;
export const AuthorityRequestStatus = z.enum(AUTHORITY_REQUEST_STATUSES);
export type AuthorityRequestStatus = z.infer<typeof AuthorityRequestStatus>;
export const AUTHORITY_REQUEST_FINAL: readonly AuthorityRequestStatus[] = ["ANSWERED", "REJECTED", "WITHDRAWN"];

/** Transiciones permitidas. Retirar o rechazar se puede antes de la revisión; responder, solo después. */
export const AUTHORITY_REQUEST_TRANSITIONS: Record<AuthorityRequestStatus, readonly AuthorityRequestStatus[]> = {
  RECEIVED: ["IN_LEGAL_REVIEW", "REJECTED", "WITHDRAWN"],
  IN_LEGAL_REVIEW: ["ANSWERED", "REJECTED", "WITHDRAWN"],
  ANSWERED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/**
 * A qué se refiere el requerimiento, solo con identificadores internos (seudónimos), nunca con nombres, teléfonos ni
 * correos: el registro no copia datos personales.
 */
export const AuthoritySubjectRef = z.string().regex(/^(user|post|comment|report|event|business):[0-9a-f-]{36}$/);

const Note = z.string().trim().min(1).max(2000);

export const CreateAuthorityRequest = z.object({
  authority: z.string().trim().min(2).max(200),
  country: CountryCode,
  jurisdiction: z.string().trim().min(1).max(200).optional(),
  externalReference: z.string().trim().min(1).max(200).optional(),
  type: AuthorityRequestType,
  channel: AuthorityRequestChannel,
  legalBasis: z.string().trim().min(1).max(1000).optional(),
  receivedAt: Instant,
  dueAt: Instant.optional(),
  subjectRefs: z.array(AuthoritySubjectRef).max(50).default([]),
  summary: Note,
});
export type CreateAuthorityRequest = z.infer<typeof CreateAuthorityRequest>;

export const ChangeAuthorityRequestStatus = z.object({ status: AuthorityRequestStatus, note: Note });
export type ChangeAuthorityRequestStatus = z.infer<typeof ChangeAuthorityRequestStatus>;
export const AddAuthorityRequestNote = z.object({ note: Note });
export type AddAuthorityRequestNote = z.infer<typeof AddAuthorityRequestNote>;
export const AuthorityRequestListQuery = z.object({
  status: AuthorityRequestStatus.optional(),
  /** Id del último de la página anterior (ADR 0296). */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface AuthorityRequestSummary {
  id: string;
  authority: string;
  country: string;
  type: AuthorityRequestType;
  status: AuthorityRequestStatus;
  receivedAt: string;
  dueAt: string | null;
  /** Vencido y todavía sin cerrar. */
  overdue: boolean;
}
export interface AuthorityRequestLogEntry {
  at: string;
  actorUserId: string | null;
  action: "CREATED" | "STATUS_CHANGED" | "NOTE_ADDED";
  fromStatus: AuthorityRequestStatus | null;
  toStatus: AuthorityRequestStatus | null;
  note: string | null;
}
export interface AuthorityRequestDetail extends AuthorityRequestSummary {
  jurisdiction: string | null;
  externalReference: string | null;
  channel: AuthorityRequestChannel;
  legalBasis: string | null;
  subjectRefs: string[];
  summary: string;
  createdAt: string;
  log: AuthorityRequestLogEntry[];
}
