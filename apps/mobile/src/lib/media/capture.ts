import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { newId } from "../ids";
import { fitWithin, IMAGE_JPEG_QUALITY, sha256OfChunks, videoMime, VIDEO_MAX_SECONDS, type LocalMedia } from "./local-media";

export type CaptureSource = "camera" | "library";
export type CaptureKind = "IMAGE" | "VIDEO_RECORDED";

const CHUNK = 256 * 1024;

/** Directorio propio para media pendiente de envío: sobrevive a la limpieza de caché del sistema. */
const pendingDir = () => {
  const d = new Directory(Paths.document, "pending-media");
  d.create({ intermediates: true, idempotent: true });
  return d;
};

async function* readChunks(file: File): AsyncGenerator<Uint8Array> {
  const handle = file.open();
  try {
    for (;;) {
      const chunk = handle.readBytes(CHUNK);
      if (chunk.length === 0) return;
      yield chunk;
      await Promise.resolve(); // cede el hilo de JS entre bloques
    }
  } finally {
    handle.close();
  }
}

/**
 * Captura o elige una foto o un video (mismo flujo en Android e iOS):
 * - foto: se re-codifica a JPEG con el lado mayor ≤ 1920 px. Re-codificar aplica la orientación a los píxeles
 *   y descarta Exif (incluido el GPS) ya en el dispositivo; el servidor lo vuelve a comprobar.
 * - video: máximo 60 s y calidad 720p en la captura.
 * Devuelve null si el usuario cancela o no concede el permiso.
 */
export async function captureMedia(source: CaptureSource, kind: CaptureKind): Promise<LocalMedia | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: kind === "IMAGE" ? ["images"] : ["videos"],
    quality: 1,
    exif: false,
    allowsMultipleSelection: false,
    videoMaxDuration: VIDEO_MAX_SECONDS,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
  };
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const capturedAt = new Date().toISOString();

  if (kind === "IMAGE") {
    const ctx = ImageManipulator.manipulate(asset.uri);
    const size = fitWithin(asset.width, asset.height);
    if (size) ctx.resize(size);
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: IMAGE_JPEG_QUALITY });
    return persist(new File(saved.uri), {
      kind: "IMAGE", mime: "image/jpeg", width: saved.width, height: saved.height, durationMs: null,
      capturedInApp: source === "camera", capturedAt,
    });
  }

  return persist(new File(asset.uri), {
    kind: "VIDEO_RECORDED", mime: videoMime(asset.uri, asset.mimeType), width: asset.width, height: asset.height,
    durationMs: asset.duration ?? null, capturedInApp: source === "camera", capturedAt,
  });
}

async function persist(src: File, meta: Omit<LocalMedia, "localUri" | "sizeBytes" | "sha256">): Promise<LocalMedia> {
  const ext = meta.mime === "image/jpeg" ? "jpg" : meta.mime === "video/quicktime" ? "mov" : "mp4";
  const dest = new File(pendingDir(), `${newId()}.${ext}`);
  await src.copy(dest);
  const { hex, size } = await sha256OfChunks(readChunks(dest));
  return { ...meta, localUri: dest.uri, sizeBytes: size, sha256: hex };
}

/** Borra la copia local cuando el reporte ya se envió (o se descartó). */
export function discardLocal(m: Pick<LocalMedia, "localUri">): void {
  try {
    const f = new File(m.localUri);
    if (f.exists) f.delete();
  } catch {
    // Si ya no existe, no hay nada que limpiar.
  }
}
