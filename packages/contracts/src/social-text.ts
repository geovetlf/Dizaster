import { z } from "zod";

/**
 * Etiquetas (#tag) y menciones (@handle) dentro del texto de un post (Blueprint RF-02, §5.4). Mismas reglas en
 * el servidor y en la app: lo que la app resalta es exactamente lo que el servidor indexa.
 */
export const MAX_TAGS_PER_POST = 10;
export const MAX_MENTIONS_PER_POST = 10;
export const POST_TEXT_MAX = 2000;

// Precedido de inicio o de algo que no sea letra/número (así "a#b" o "mail@x.com" no cuentan).
const TAG_RE = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]{2,50})/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_@.])@([A-Za-z0-9_]{2,30})/gu;

/**
 * Forma canónica de una etiqueta: minúsculas y sin tildes, así #Inundación, #inundacion y #INUNDACIÓN son la misma.
 * Se conserva la forma en que se escribió por primera vez para mostrarla.
 */
export function normalizeTag(raw: string): string {
  return raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function isValidTag(raw: string): boolean {
  return /^[\p{L}\p{N}_]{2,50}$/u.test(raw) && !/^\d+$/.test(raw);
}

/** Etiquetas del texto, sin repetir (por forma canónica), en orden de aparición. Las solo numéricas no cuentan. */
export function extractTags(text: string | null | undefined): { normalized: string; display: string }[] {
  if (!text) return [];
  const out = new Map<string, string>();
  for (const m of text.matchAll(TAG_RE)) {
    const display = m[2]!;
    if (/^\d+$/.test(display)) continue;
    const n = normalizeTag(display);
    if (!out.has(n)) out.set(n, display);
    if (out.size >= MAX_TAGS_PER_POST) break;
  }
  return [...out].map(([normalized, display]) => ({ normalized, display }));
}

/** Handles mencionados, en minúsculas y sin repetir. Que existan lo decide el servidor. */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    out.add(m[2]!.toLowerCase());
    if (out.size >= MAX_MENTIONS_PER_POST) break;
  }
  return [...out];
}

/** Trozos del texto para pintarlo: texto normal, etiqueta o mención (la app decide qué es tocable). */
export type TextSegment = { kind: "text"; text: string } | { kind: "tag"; text: string; tag: string } | { kind: "mention"; text: string; handle: string };

export function segmentText(text: string): TextSegment[] {
  const marks: { start: number; end: number; seg: TextSegment }[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index! + m[1]!.length;
    if (/^\d+$/.test(m[2]!)) continue;
    marks.push({ start, end: start + 1 + m[2]!.length, seg: { kind: "tag", text: `#${m[2]}`, tag: normalizeTag(m[2]!) } });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index! + m[1]!.length;
    marks.push({ start, end: start + 1 + m[2]!.length, seg: { kind: "mention", text: `@${m[2]}`, handle: m[2]!.toLowerCase() } });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: TextSegment[] = [];
  let at = 0;
  for (const k of marks) {
    if (k.start < at) continue;
    if (k.start > at) out.push({ kind: "text", text: text.slice(at, k.start) });
    out.push(k.seg);
    at = k.end;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** Publicar sin reporte: opinión, apoyo, noticia o comentario sobre un EVENT desde cualquier lugar (D-03). */
export const CreatePostRequest = z.object({
  text: z.string().trim().min(1).max(POST_TEXT_MAX),
  mediaIds: z.array(z.uuid()).max(4).default([]),
  /** EVENT que el post menciona. No alimenta pin ni verificación: solo lo enlaza. */
  eventId: z.uuid().optional(),
  anonymityMode: z.enum(["PUBLIC", "PSEUDONYMOUS"]).default("PUBLIC"),
  /** Publicar como uno de mis negocios (handle). Un negocio nunca publica de forma seudónima. */
  asBusiness: z.string().trim().toLowerCase().max(30).optional(),
});
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

export const TagParam = z.object({ tag: z.string().min(2).max(60).refine(isValidTag, "Etiqueta inválida") });

export const TagSearchQuery = z.object({
  q: z.string().trim().min(1).max(50),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export interface TagView {
  tag: string;
  display: string;
  postCount: number;
  followerCount: number;
  followedByMe: boolean;
}

/** Textos más cortos que esto ("ayuda", "se cayó") coinciden de buena fe y no cuentan como spam. */
export const TEXT_FINGERPRINT_MIN_CHARS = 25;

/**
 * Forma canónica para detectar el mismo mensaje pegado por varias cuentas (ADR 0031): sin tildes, minúsculas y
 * solo letras y números, así cambiar espacios, signos, emojis o mayúsculas no lo esconde. Null si es muy corto.
 */
export function textFingerprintBase(text: string | null | undefined): string | null {
  if (!text) return null;
  const base = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return base.length >= TEXT_FINGERPRINT_MIN_CHARS ? base : null;
}
