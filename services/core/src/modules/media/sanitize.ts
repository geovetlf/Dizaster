/**
 * Saneamiento de privacidad de la media, sin re-codificar ni dependencias nativas.
 *
 * - JPEG: se eliminan los segmentos de metadatos (APP1 Exif/XMP, APP13 IPTC, comentarios). El GPS de la cámara
 *   vive en Exif. Se conserva APP2 (perfil de color). La app ya sube la foto re-codificada con la orientación
 *   aplicada a los píxeles, así que quitar Exif no la gira.
 * - MP4/MOV: la ubicación se guarda dentro de `moov` como cadena ISO 6709 (`©xyz` en Android,
 *   `com.apple.quicktime.location.ISO6709` en iOS) o como caja `loci` (3GPP). Se neutralizan en el sitio
 *   (mismo tamaño) para no romper los desplazamientos del archivo. Los datos de video (`mdat`) no se tocan.
 */

export type MediaFamily = "image/jpeg" | "video/isobmff";

export function sniffFamily(head: Uint8Array): MediaFamily | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") return "video/isobmff";
  return null;
}

export function familyOfMime(mime: string): MediaFamily | null {
  if (mime === "image/jpeg") return "image/jpeg";
  if (mime === "video/mp4" || mime === "video/quicktime") return "video/isobmff";
  return null;
}

export interface SanitizeResult {
  data: Uint8Array;
  /** Qué se quitó o neutralizó (para auditoría). */
  removed: string[];
}

export class MalformedMediaError extends Error {}

export function sanitize(family: MediaFamily, data: Uint8Array): SanitizeResult {
  return family === "image/jpeg" ? stripJpegMetadata(data) : neutralizeIsoBmffLocation(data);
}

// ───────────── JPEG ─────────────

const DROP_JPEG_MARKERS = new Map<number, string>([
  [0xe1, "APP1 (Exif/XMP)"],
  [0xed, "APP13 (IPTC)"],
  [0xfe, "COM"],
]);

export function stripJpegMetadata(src: Uint8Array): SanitizeResult {
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new MalformedMediaError("No es JPEG");
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  const removed: string[] = [];
  let i = 2;
  while (i < src.length) {
    if (src[i] !== 0xff) throw new MalformedMediaError(`Marcador JPEG inválido en ${i}`);
    const marker = src[i + 1]!;
    if (marker === 0xff) { i += 1; continue; } // relleno
    // Inicio de datos de imagen: el resto se copia tal cual.
    if (marker === 0xda) { parts.push(src.subarray(i)); break; }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(src.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > src.length) throw new MalformedMediaError("Segmento JPEG truncado");
    const len = (src[i + 2]! << 8) | src[i + 3]!;
    const end = i + 2 + len;
    if (len < 2 || end > src.length) throw new MalformedMediaError("Longitud de segmento JPEG inválida");
    const drop = DROP_JPEG_MARKERS.get(marker);
    if (drop) removed.push(drop);
    else parts.push(src.subarray(i, end));
    i = end;
  }
  return { data: concat(parts), removed };
}

// ───────────── MP4 / MOV (ISO BMFF) ─────────────

// Coordenadas ISO 6709: ±DD.D±DDD.D[±alt][CRS…]/
const ISO6709 = /[+-]\d{2}(?:\.\d+)?[+-]\d{3}(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?/g;

export function neutralizeIsoBmffLocation(src: Uint8Array): SanitizeResult {
  const data = new Uint8Array(src); // copia: no se modifica la entrada
  const removed: string[] = [];
  let sawMoov = false;
  for (const box of topLevelBoxes(data)) {
    if (box.type !== "moov") continue;
    sawMoov = true;
    const start = box.start + box.header;
    const end = box.end;

    const text = latin1(data, start, end);
    for (const m of text.matchAll(ISO6709)) {
      const at = start + m.index;
      for (let k = 0; k < m[0].length; k++) {
        const c = data[at + k]!;
        if (c >= 0x30 && c <= 0x39) data[at + k] = 0x30; // dígitos → 0; signos y puntos intactos
      }
      removed.push("ISO6709");
    }

    // Caja 3GPP `loci`: FullBox + idioma + nombre + rol + longitud/latitud/altitud en punto fijo.
    for (let p = text.indexOf("loci"); p !== -1; p = text.indexOf("loci", p + 4)) {
      const boxStart = start + p - 4;
      if (boxStart < start) continue;
      const size = readU32(data, boxStart);
      const boxEnd = boxStart + size;
      if (size < 12 || boxEnd > end) continue;
      data.fill(0, boxStart + 12, boxEnd); // se conserva la cabecera y la versión; el contenido queda en cero
      removed.push("loci");
    }
  }
  if (!sawMoov) throw new MalformedMediaError("Video sin caja moov");
  return { data, removed: [...new Set(removed)] };
}

interface Box { type: string; start: number; header: number; end: number }

export function topLevelBoxes(data: Uint8Array): Box[] {
  const boxes: Box[] = [];
  let i = 0;
  while (i + 8 <= data.length) {
    let size = readU32(data, i);
    const type = ascii(data, i + 4, i + 8);
    let header = 8;
    if (size === 1) {
      if (i + 16 > data.length) throw new MalformedMediaError("Caja de 64 bits truncada");
      size = Number(new DataView(data.buffer, data.byteOffset + i + 8, 8).getBigUint64(0));
      header = 16;
    } else if (size === 0) {
      size = data.length - i;
    }
    if (size < header || i + size > data.length) throw new MalformedMediaError(`Caja ${type} con tamaño inválido`);
    boxes.push({ type, start: i, header, end: i + size });
    i += size;
  }
  return boxes;
}

// ───────────── Duración y tamaño reales del video (ADR 0071) ─────────────

export interface VideoInfo { durationMs: number; width: number | null; height: number | null }

/** Cajas hijas dentro de [from, to). Mismas reglas que las de primer nivel. */
function childBoxes(data: Uint8Array, from: number, to: number): Box[] {
  return topLevelBoxes(data.subarray(from, to)).map((b) => ({ ...b, start: b.start + from, end: b.end + from }));
}

/**
 * Lee `moov/mvhd` (escala de tiempo y duración) y el `tkhd` de la pista de video (`hdlr` = "vide"). No confía en lo
 * que declaró el teléfono: el límite de 60 s y las dimensiones guardadas salen del archivo.
 */
export function videoInfo(data: Uint8Array): VideoInfo {
  const moov = topLevelBoxes(data).find((b) => b.type === "moov");
  if (!moov) throw new MalformedMediaError("Video sin caja moov");
  const kids = childBoxes(data, moov.start + moov.header, moov.end);
  const mvhd = kids.find((b) => b.type === "mvhd");
  if (!mvhd) throw new MalformedMediaError("Video sin mvhd");
  const p = mvhd.start + mvhd.header;
  const version = data[p]!;
  const view = new DataView(data.buffer, data.byteOffset);
  const need = version === 1 ? 32 : 20;
  if (p + need > mvhd.end) throw new MalformedMediaError("mvhd truncado");
  const timescale = version === 1 ? view.getUint32(p + 20) : view.getUint32(p + 12);
  const duration = version === 1 ? Number(view.getBigUint64(p + 24)) : view.getUint32(p + 16);
  if (!timescale) throw new MalformedMediaError("Video sin escala de tiempo");
  let width: number | null = null;
  let height: number | null = null;
  for (const trak of kids.filter((b) => b.type === "trak")) {
    const parts = childBoxes(data, trak.start + trak.header, trak.end);
    const mdia = parts.find((b) => b.type === "mdia");
    const hdlr = mdia ? childBoxes(data, mdia.start + mdia.header, mdia.end).find((b) => b.type === "hdlr") : undefined;
    if (!hdlr || hdlr.start + hdlr.header + 12 > hdlr.end || ascii(data, hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12) !== "vide") continue;
    const tkhd = parts.find((b) => b.type === "tkhd");
    if (!tkhd || tkhd.end - 8 < tkhd.start + tkhd.header) continue;
    // Ancho y alto: los últimos 8 bytes de tkhd, en punto fijo 16.16.
    width = view.getUint32(tkhd.end - 8) >>> 16;
    height = view.getUint32(tkhd.end - 4) >>> 16;
    break;
  }
  return { durationMs: Math.round((duration / timescale) * 1000), width, height };
}

// ───────────── utilidades ─────────────

function readU32(d: Uint8Array, at: number): number {
  return ((d[at]! << 24) >>> 0) + (d[at + 1]! << 16) + (d[at + 2]! << 8) + d[at + 3]!;
}

function ascii(d: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...d.subarray(from, to));
}

function latin1(d: Uint8Array, from: number, to: number): string {
  return Buffer.from(d.buffer, d.byteOffset + from, to - from).toString("latin1");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
