import type { AcceptPoliciesRequest, PolicyDocumentStatus, PolicyStatusResponse } from "@dizaster/contracts";

/**
 * Términos y políticas pendientes (ADR 0176): primero los obligatorios. Sin textos publicados la lista está vacía y
 * la app no pide nada. NO AI REQUIRED.
 */
export function pendingPolicies(s: PolicyStatusResponse | null): PolicyDocumentStatus[] {
  if (!s) return [];
  return s.documents.filter((d) => d.pending).sort((a, b) => Number(b.required) - Number(a.required));
}

/** Se acepta exactamente la versión que se mostró: si cambió entretanto, el servidor responde 409. */
export function acceptBody(docs: readonly PolicyDocumentStatus[]): AcceptPoliciesRequest {
  return { accept: docs.map((d) => ({ kind: d.kind, version: d.version })) };
}

/** Una versión nueva de algo ya aceptado se presenta como "actualizado". */
export const isUpdate = (d: PolicyDocumentStatus) => d.acceptedVersion !== null && d.acceptedVersion !== d.version;
