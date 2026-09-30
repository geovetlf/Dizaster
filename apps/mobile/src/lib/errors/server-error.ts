import type { Lang } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Códigos de error del servidor que la app traduce (ADR 0105). El servidor responde `{ error, message }` con el
 * mensaje en español; en español se muestra tal cual (es el más preciso: "Puedes administrar hasta 3 negocios"),
 * en otro idioma se muestra la traducción del código y, si el código no está aquí, la del estado HTTP: nunca el
 * mensaje en español (ADR 0281). NO AI REQUIRED.
 */
export const SERVER_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  RATE_LIMITED: "errRateLimited",
  APP_UPDATE_REQUIRED: "errUpdateRequired",
  POLICY_ACCEPTANCE_REQUIRED: "errPolicyRequired",
  POLICY_VERSION_MISMATCH: "errPolicyChanged",
  MEDIA_NOT_CAPTURED_IN_APP: "errCameraOnly",
  AUTHORITY_REQUEST_TRANSITION: "errAuthorityTransition",
  MEDIA_HELD: "errMediaHeld",
  DAILY_UPLOAD_QUOTA: "errRateLimited",
  NOT_FOUND: "errNotFound",
  FORBIDDEN: "errForbidden",
  UNAUTHENTICATED: "errUnauthenticated",
  VALIDATION: "errValidation",
  BAD_REQUEST: "errValidation",
  LIMIT_REACHED: "errLimitReached",
  BLOCKED: "errBlocked",
  HANDLE_TAKEN: "errHandleTaken",
  ACCOUNT_SUSPENDED: "errAccountSuspended",
  ACCOUNT_INACTIVE: "errAccountInactive",
  UNDER_MIN_AGE: "errUnderMinAge",
  AGE_CONFIRMATION_REQUIRED: "errAgeConfirmation",
  FEATURE_DISABLED: "errFeatureDisabled",
  MFA_INVALID_CODE: "errMfaInvalidCode",
  BUSINESS_REMOVED: "errBusinessRemoved",
  EVIDENCE_REQUIRED: "errEvidenceRequired",
  REASON_REQUIRED: "errReasonRequired",
  CONFLICT: "errConflict",
  ALREADY_DECIDED: "errConflict",
  CASE_CLAIMED: "errCaseClaimed",
  CASE_CLOSED: "errConflict",
  POST_NOT_EDITABLE: "errPostNotEditable",
  EDIT_WINDOW_CLOSED: "errPostNotEditable",
  NOT_INSTITUTIONAL: "errNotInstitutional",
  OUT_OF_SCOPE: "errOutOfScope",
  INTERNAL: "errInternal",
  // ADR 0197: todos los códigos del servidor tienen traducción (lo comprueba test/server-error-codes.test.ts).
  INVALID_CODE: "errInvalidCode",
  NOT_APPEALABLE: "errNotAppealable",
  MEDIA_NOT_READY: "errMediaNotReady",
  UPLOAD_MISSING: "errUploadMissing",
  INVALID_UPLOAD: "errMediaUnsupported",
  MEDIA_KIND_UNSUPPORTED: "errMediaUnsupported",
  MEDIA_IN_USE: "errMediaInUse",
  MEDIA_ALREADY_ATTACHED: "errMediaInUse",
  MFA_REQUIRED: "errMfaRequired",
  MFA_SESSION_REQUIRED: "errMfaRequired",
  MFA_ENROLLMENT_REQUIRED: "errMfaRequired",
  MFA_NOT_ENROLLED: "errMfaRequired",
  MFA_ALREADY_ENROLLED: "errConflict",
  IDENTITY_IN_USE: "errIdentityInUse",
  AUTH_PROVIDER_DISABLED: "errSignInUnavailable",
  EMAIL_NOT_CONFIGURED: "errSignInUnavailable",
  INVALID_CREDENTIAL: "errSignInFailed",
  INVALID_REFRESH: "errUnauthenticated",
  UNKNOWN_DEVICE: "errUnauthenticated",
  DEVICE_NOT_FOUND: "errUnauthenticated",
  ALREADY_STATED: "errAlreadyAnswered",
  NOTHING_TO_ANSWER: "errAlreadyAnswered",
  CONFLICT_OF_INTEREST: "errConflictOfInterest",
  LAST_ADMIN: "errLastAdmin",
  REPORT_POST: "errPostNotEditable",
  CLIENT_ID_REUSED: "errConflict",
  CONFLICT_WITH_OFFICIAL: "errConflict",
  EVENT_ALREADY_MERGED: "errConflict",
  MERGE_ALREADY_REVERTED: "errConflict",
  SPLIT_WOULD_EMPTY: "errConflict",
  SENSITIVITY_NOT_RAISED: "errConflict",
  SOURCE_NOT_ACTIVE: "errConflict",
  SOURCE_NOT_PAUSABLE: "errConflict",
  PUSH_PROVIDER_MISMATCH: "errConflict",
  SIGNING_KEY_REUSED: "errConflict",
  INVALID_REPORT: "errValidation",
  INVALID_TARGET: "errValidation",
  REACTION_NOT_APPLICABLE: "errValidation",
  MEDIA_NOT_FOUND: "errNotFound",
  ORIGINAL_GONE: "errNotFound",
  UNKNOWN_SOURCE: "errNotFound",
  AI_CANNOT_CONFIRM: "errForbidden",
  OVERLOADED: "errOverloaded",
};

/** Mensaje que ve la persona para una respuesta de error del servidor. */
export function serverErrorMessage(
  body: { error?: unknown; message?: unknown } | null | undefined,
  status: number,
  lang: Lang,
  translate: (key: MessageKey) => string,
): string {
  const message = typeof body?.message === "string" && body.message.trim() ? body.message : null;
  if (lang === "es" && message) return message;
  const code = typeof body?.error === "string" ? body.error : null;
  const key = code ? SERVER_ERROR_KEYS[code] : undefined;
  if (key) return translate(key);
  if (message && lang === "es") return message;
  const byStatus = STATUS_KEYS[status] ?? (status >= 500 ? "errInternal" : status >= 400 ? "errValidation" : undefined);
  return byStatus ? translate(byStatus) : `HTTP ${status}`;
}

/** Estado HTTP → texto, para códigos que la app todavía no conoce (ADR 0281). */
const STATUS_KEYS: Readonly<Record<number, MessageKey>> = {
  401: "errUnauthenticated",
  403: "errForbidden",
  404: "errNotFound",
  409: "errConflict",
  429: "errRateLimited",
  503: "errOverloaded",
};
