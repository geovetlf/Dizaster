import type { MessageKey } from "../i18n";

/**
 * Errores de la subida de media que genera la propia app (ADR 0285). El uploader devuelve un código, no un texto:
 * el código se guarda en la cola offline y se traduce al mostrarlo, así un cambio de idioma posterior también se
 * aplica y nada llega en español a quien usa otro idioma (ADR 0281).
 */
export const UPLOAD_ERROR_KEYS = {
  LOCAL_FILE_MISSING: "errLocalFileMissing",
  UPLOAD_REJECTED: "errUploadRejected",
  MEDIA_REJECTED: "errMediaRejected",
} as const satisfies Record<string, MessageKey>;

export type UploadErrorCode = keyof typeof UPLOAD_ERROR_KEYS;

/** Texto de un motivo de fallo: un código de subida se traduce; otro texto (ya traducido por la API) queda igual. */
export function uploadErrorText(reason: string, translate: (key: MessageKey) => string): string {
  const key = (UPLOAD_ERROR_KEYS as Record<string, MessageKey>)[reason];
  return key ? translate(key) : reason;
}
