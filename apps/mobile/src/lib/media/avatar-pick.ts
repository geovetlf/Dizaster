import { api } from "../api";
import { t } from "../i18n";
import { waitForProcessed } from "./avatar-ready";
import { captureMedia, discardLocal } from "./capture";
import { uploadMedia } from "./upload";
import { uploadErrorText } from "./upload-errors";

/**
 * Elegir una foto de la galería para el perfil o un negocio (ADR 0119): se re-codifica en el dispositivo (sin Exif),
 * se sube, se espera a la versión saneada y devuelve su id. null si la persona cancela.
 */
export async function pickProcessedImage(): Promise<string | null> {
  const local = await captureMedia("library", "IMAGE");
  if (!local) return null;
  try {
    const r = await uploadMedia(local);
    if (!r.ok) throw new Error(uploadErrorText(r.error, t));
    const ready = await waitForProcessed(
      async () => (await api.mediaState(r.mediaId)).state,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    if (ready !== "READY") throw new Error(t(ready === "REJECTED" ? "avatarRejected" : "avatarSlow"));
    return r.mediaId;
  } finally {
    discardLocal(local);
  }
}
