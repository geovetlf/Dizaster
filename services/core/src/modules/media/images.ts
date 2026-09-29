import sharp, { type Metadata } from "sharp";
import { MalformedMediaError } from "./sanitize.js";

/**
 * Variantes públicas de una foto (Blueprint §5.9, RF-10). Se generan re-codificando el original: el resultado
 * no lleva ningún metadato (ni Exif, ni GPS, ni perfil de cámara) y pesa mucho menos, que es lo que más
 * abarata la entrega por CDN. La orientación Exif se aplica antes de descartarla.
 */
export const IMAGE_VARIANTS = {
  DISPLAY: { maxSide: 1600, quality: 80 },
  THUMB_S: { maxSide: 400, quality: 70 },
} as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;

/** Imágenes de más de 50 megapíxeles se rechazan: protege al worker de "bombas" de descompresión. */
const MAX_INPUT_PIXELS = 50_000_000;

export interface RenderedImage {
  width: number;
  height: number;
  variants: { variant: ImageVariant; data: Buffer; width: number; height: number }[];
  phash: string;
}

export async function renderImage(original: Uint8Array): Promise<RenderedImage> {
  const input = () => sharp(original, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  let meta: Metadata;
  try {
    meta = await input().metadata();
  } catch (err) {
    throw new MalformedMediaError(`No se pudo decodificar la imagen: ${(err as Error).message}`);
  }
  try {
    // Con orientación 5–8 el lado largo se intercambia: se toma el tamaño ya rotado.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? 0;
    const height = (swap ? meta.width : meta.height) ?? 0;
    const variants: RenderedImage["variants"] = [];
    for (const [variant, spec] of Object.entries(IMAGE_VARIANTS) as [ImageVariant, (typeof IMAGE_VARIANTS)[ImageVariant]][]) {
      const { data, info } = await input()
        .resize({ width: spec.maxSide, height: spec.maxSide, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: spec.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      variants.push({ variant, data, width: info.width, height: info.height });
    }
    const gray = await input().resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer();
    return { width, height, variants, phash: dctHash(gray) };
  } catch (err) {
    throw new MalformedMediaError(`Imagen dañada: ${(err as Error).message}`);
  }
}

// ───────────── Hash perceptual (pHash por DCT) ─────────────

const N = 32;
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));

/**
 * pHash clásico: DCT 2D de la imagen en gris a 32×32, se toman las 8×8 frecuencias más bajas y cada bit dice si
 * está por encima de la mediana (sin contar la componente continua). Fotos casi idénticas (recomprimidas,
 * reescaladas, con otro brillo) dan hashes a pocos bits de distancia. Devuelve 16 caracteres hexadecimales.
 */
export function dctHash(gray: Uint8Array): string {
  if (gray.length !== N * N) throw new Error(`Se esperaban ${N * N} píxeles`);
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        const cy = COS[u]![y]!;
        for (let x = 0; x < N; x++) sum += gray[y * N + x]! * cy * COS[v]![x]!;
      }
      coeffs.push(sum);
    }
  }
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[31]!;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (coeffs[i + b]! > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/**
 * Bandas para buscar parecidos con un índice: 8 bandas de 8 bits, codificadas como banda·256 + valor. Si dos
 * hashes difieren en 7 bits o menos, al menos una banda coincide exactamente (principio del palomar), así que
 * basta buscar por solapamiento de bandas y confirmar la distancia.
 */
export function phashBands(hex: string): number[] {
  return Array.from({ length: 8 }, (_, i) => i * 256 + parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** Distancia máxima (bits) para considerar dos fotos la misma imagen. */
export const NEAR_DUPLICATE_BITS = 6;
