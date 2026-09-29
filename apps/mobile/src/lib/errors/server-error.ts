import type { Lang } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Códigos de error del servidor que la app traduce (ADR 0105). El servidor responde `{ error, message }` con el
 * mensaje en español; en español se muestra tal cual (es el más preciso: "Puedes administrar hasta 3 negocios"),
 * en otro idioma se muestra la traducción del código y, si el código no está aquí, el mensaje del servidor.
 * NO AI REQUIRED.
 */
export const SERVER_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  RATE_LIMITED: "errRateLimited",
  DAILY_UPLOAD_QUOTA: "errRateLimited",
  NOT_FOUND: "errNotFound",
  FORBIDDEN: "errForbidden",
  UNAUTHENTICATED: "errUnauthenticated",
  VALIDATION: "errValidation",
  BAD_REQUEST: "errValidation",
  LIMIT_REACHED: "errLimitReached",
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
  INTERNAL: "errInternal",
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
  if (message) return message;
  if (status === 429) return translate("errRateLimited");
  if (status >= 500) return translate("errInternal");
  return `HTTP ${status}`;
}
