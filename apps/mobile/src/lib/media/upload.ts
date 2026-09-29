import { File, UploadType } from "expo-file-system";
import { api } from "../api";
import { toUploadRequest, type LocalMedia } from "./local-media";
import type { MediaUploader } from "../report/queue";

/**
 * Subida directa al almacenamiento con la URL firmada (el archivo no pasa por la API). Mismo código en
 * Android e iOS: la transferencia la hace el módulo nativo en streaming, sin cargar el video en memoria.
 */
export const uploadMedia: MediaUploader = async (m: LocalMedia) => {
  try {
    const file = new File(m.localUri);
    if (!file.exists) return { ok: false, retryable: false, error: "El archivo local ya no existe" };
    const { mediaId, upload, posterUpload } = await api.createUpload(toUploadRequest(m));
    // content-length lo fija el sistema a partir del archivo; el resto de cabeceras firmadas se envía tal cual.
    const { "content-length": _len, ...headers } = upload.headers;
    const res = await file.upload(upload.url, { httpMethod: upload.method, uploadType: UploadType.BINARY_CONTENT, headers });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, retryable: res.status >= 500 || res.status === 403, error: `Subida rechazada (${res.status})` };
    }
    // El póster es accesorio: si falla, el video sale igual y el servidor lo muestra sin miniatura.
    if (posterUpload && m.poster) {
      const poster = new File(m.poster.localUri);
      if (poster.exists) {
        const { "content-length": _plen, ...posterHeaders } = posterUpload.headers;
        await poster.upload(posterUpload.url, { httpMethod: posterUpload.method, uploadType: UploadType.BINARY_CONTENT, headers: posterHeaders }).catch(() => undefined);
      }
    }
    const done = await api.completeUpload(mediaId);
    if (done.state === "REJECTED") return { ok: false, retryable: false, error: "El servidor rechazó el archivo" };
    return { ok: true, mediaId };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { ok: false, retryable: status === undefined || status >= 500 || status === 429 || status === 409, error: (err as Error).message };
  }
};
