import { z } from "zod";

/**
 * Aceptación versionada de términos y políticas (ADR 0176). Solo el mecanismo: los textos están BLOQUEADOS hasta
 * tener asesoría legal. Un documento con `version: null` no existe todavía y no se pide aceptar.
 */
export const LegalDocumentKind = z.enum(["TERMS", "PRIVACY", "COMMUNITY_GUIDELINES"]);
export type LegalDocumentKind = z.infer<typeof LegalDocumentKind>;

export const LegalDocument = z.object({
  kind: LegalDocumentKind,
  version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/).nullable(),
  url: z.url().nullable(),
  /** Si hace falta aceptarlo para publicar e interactuar. */
  required: z.boolean(),
});
export type LegalDocument = z.infer<typeof LegalDocument>;

export const LegalDocumentsFile = z.object({
  version: z.string(),
  notes: z.string().optional(),
  documents: z.array(LegalDocument),
}).refine((f) => new Set(f.documents.map((d) => d.kind)).size === f.documents.length, "Documento repetido")
  .refine((f) => f.documents.every((d) => d.version === null || d.url !== null), "Un documento con versión necesita url");
export type LegalDocumentsFile = z.infer<typeof LegalDocumentsFile>;

export interface PolicyDocumentStatus {
  kind: LegalDocumentKind;
  version: string;
  url: string;
  required: boolean;
  acceptedVersion: string | null;
  /** Hay una versión vigente que la cuenta aún no aceptó. */
  pending: boolean;
}
export interface PolicyStatusResponse { documents: PolicyDocumentStatus[] }

export const AcceptPoliciesRequest = z.object({
  accept: z.array(z.object({ kind: LegalDocumentKind, version: z.string().min(1).max(40) })).min(1).max(3),
});
export type AcceptPoliciesRequest = z.infer<typeof AcceptPoliciesRequest>;
