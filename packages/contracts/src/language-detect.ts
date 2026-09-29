/**
 * Idioma de un texto corto, en el dispositivo o el servidor y sin modelo externo (ADR 0091, Blueprint §5.15). NO AI
 * REQUIRED. Puntúa palabras vacías muy frecuentes y rasgos ortográficos de cada idioma soportado; si el texto es
 * muy corto o no hay un ganador claro, devuelve null (mejor no decir nada que equivocarse).
 */
export type DetectedLang = "es" | "en" | "pt" | "fr";

const STOPWORDS: Record<DetectedLang, string[]> = {
  es: ["el", "la", "los", "las", "de", "del", "y", "en", "que", "un", "una", "por", "con", "para", "es", "se", "no", "hay", "al", "lo", "su", "pero", "muy", "está", "están", "como", "más", "ya", "todo", "mi", "calle", "fuego", "agua", "ayuda", "cerca", "aquí"],
  en: ["the", "and", "of", "to", "in", "is", "it", "that", "for", "on", "with", "this", "there", "are", "was", "at", "be", "have", "no", "not", "near", "my", "street", "fire", "water", "help", "here", "from", "by", "we", "you", "they", "all"],
  pt: ["o", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "que", "um", "uma", "por", "com", "para", "é", "não", "há", "mas", "muito", "está", "estão", "como", "mais", "já", "rua", "fogo", "água", "ajuda", "perto", "aqui", "você"],
  fr: ["le", "la", "les", "de", "des", "du", "et", "en", "que", "un", "une", "pour", "avec", "est", "il", "y", "a", "pas", "ne", "au", "aux", "sur", "dans", "mais", "très", "c'est", "rue", "feu", "eau", "aide", "près", "ici", "nous", "vous", "on"],
};
const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)])) as Record<DetectedLang, Set<string>>;

/** Rasgos casi exclusivos: pesan como varias palabras. */
const CUES: Record<DetectedLang, RegExp[]> = {
  es: [/ñ/g, /[¿¡]/g, /\b\w+ción\b/g, /\b\w+ado\b/g],
  en: [/\b\w+ing\b/g, /\b\w+'s\b/g, /\bth\w*/g],
  pt: [/[ãõ]/g, /\b\w+ção\b/g, /\b\w+ções\b/g, /\blh|nh\w*/g],
  fr: [/[èêëùœ]/g, /\b\w+eux\b/g, /\b[ldjcnsq]'\w+/g, /\b\w+tion\b/g],
};

export function detectLanguage(text: string | null | undefined): DetectedLang | null {
  if (!text) return null;
  const clean = text.toLowerCase().replace(/https?:\/\/\S+|[@#][\p{L}\p{N}_]+/gu, " ");
  const words = clean.match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return null;
  const score: Record<DetectedLang, number> = { es: 0, en: 0, pt: 0, fr: 0 };
  for (const w of words) for (const l of Object.keys(score) as DetectedLang[]) if (SETS[l].has(w)) score[l] += 1;
  for (const l of Object.keys(score) as DetectedLang[]) for (const re of CUES[l]) score[l] += 1.5 * (clean.match(re)?.length ?? 0);
  const ranked = (Object.entries(score) as [DetectedLang, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  // Ganador claro: al menos 2 puntos y un 30 % por encima del segundo.
  if (best![1] < 2 || best![1] < second![1] * 1.3) return null;
  return best![0];
}
