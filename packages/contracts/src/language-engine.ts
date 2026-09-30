import { SUPPORTED_LANGS, type Lang } from "./common.js";

/**
 * DIZASTER Language Engine (ADR 0216). Un solo registro de idiomas compartido por la app, el servidor y los datos:
 * nombre propio, dirección de escritura, locale de formato por defecto, cadena de respaldo y reglas de plural CLDR.
 * Todo es determinístico y local: la interfaz nunca se traduce con IA. Un idioma nuevo = una entrada aquí, su
 * catálogo de textos (app y servidor) y sus nombres en los datos; ninguna regla de negocio cambia.
 * NO AI REQUIRED.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type TextDirection = "ltr" | "rtl";

export interface LanguageSpec {
  /** Nombre del idioma en sí mismo: quien no entiende el idioma actual encuentra el suyo. */
  nativeName: string;
  englishName: string;
  dir: TextDirection;
  /** Locale BCP 47 para fechas y números cuando no se conoce la región de la persona. */
  defaultLocale: string;
  /** Idiomas a probar, en orden, cuando falta un texto en este (antes del respaldo global). */
  fallback: readonly Lang[];
  /** Categoría plural CLDR para enteros y decimales (misma regla en todos los teléfonos y en el servidor). */
  plural: (n: number) => PluralCategory;
}

/** Último respaldo: el idioma del piloto (Perú) y, después, inglés. */
export const GLOBAL_FALLBACK: readonly Lang[] = ["es", "en"];

// Reglas CLDR (plurals.xml) para números cardinales. i = parte entera; v = cantidad de decimales visibles.
const intPart = (n: number) => Math.floor(Math.abs(n));
const hasDecimals = (n: number) => !Number.isInteger(n);

export const LANGUAGES: Readonly<Record<Lang, LanguageSpec>> = {
  es: {
    nativeName: "Español", englishName: "Spanish", dir: "ltr", defaultLocale: "es-PE", fallback: ["en"],
    // CLDR es: one = n es 1; many = entero ≥ 1 000 000 múltiplo de un millón ("1 millón de"); other = resto.
    plural: (n) => (n === 1 ? "one" : !hasDecimals(n) && n !== 0 && n % 1_000_000 === 0 ? "many" : "other"),
  },
  en: {
    nativeName: "English", englishName: "English", dir: "ltr", defaultLocale: "en-US", fallback: ["es"],
    plural: (n) => (n === 1 ? "one" : "other"),
  },
  pt: {
    nativeName: "Português", englishName: "Portuguese", dir: "ltr", defaultLocale: "pt-BR", fallback: ["es", "en"],
    // CLDR pt: one = i en 0..1; many = múltiplos de un millón.
    plural: (n) => (intPart(n) <= 1 ? "one" : !hasDecimals(n) && n % 1_000_000 === 0 ? "many" : "other"),
  },
  fr: {
    nativeName: "Français", englishName: "French", dir: "ltr", defaultLocale: "fr-FR", fallback: ["en", "es"],
    // CLDR fr: one = i en 0..1; many = múltiplos de un millón.
    plural: (n) => (intPart(n) <= 1 ? "one" : !hasDecimals(n) && n % 1_000_000 === 0 ? "many" : "other"),
  },
};

export const isSupportedLang = (v: unknown): v is Lang => typeof v === "string" && (SUPPORTED_LANGS as readonly string[]).includes(v);

/** Idioma base de una etiqueta BCP 47 ("es-PE" → "es", "pt_BR" → "pt"), aunque no esté soportado. */
export const baseLanguage = (tag: string | null | undefined) => (tag ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
/** Región de una etiqueta BCP 47 ("es-PE" → "PE"), o null. */
export function regionOf(tag: string | null | undefined): string | null {
  const parts = (tag ?? "").replace(/_/g, "-").split("-").slice(1);
  const r = parts.find((p) => /^[A-Za-z]{2}$|^\d{3}$/.test(p));
  return r ? r.toUpperCase() : null;
}

export function pluralCategory(lang: Lang, n: number): PluralCategory {
  return LANGUAGES[lang].plural(n);
}

export const textDirection = (lang: Lang): TextDirection => LANGUAGES[lang].dir;

/** Orden en que se buscan textos para `lang`: el propio, sus respaldos y el respaldo global, sin repetir. */
export function fallbackChain(lang: Lang): Lang[] {
  return [...new Set<Lang>([lang, ...LANGUAGES[lang].fallback, ...GLOBAL_FALLBACK])];
}

/**
 * Texto localizado de un dato (`{ es: "...", en: "..." }`) con la cadena de respaldo del idioma; si no hay ninguno
 * de esos, el primero no vacío; si no hay nada, null.
 */
export function localizedText(texts: Readonly<Record<string, string | undefined>> | null | undefined, lang: Lang): string | null {
  if (!texts) return null;
  for (const l of fallbackChain(lang)) {
    const v = texts[l];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return Object.values(texts).find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;
}

export interface ResolvedLocale {
  /** Idioma de la interfaz. */
  lang: Lang;
  /** Locale BCP 47 para formatos (fecha, hora, números, moneda): idioma + región de la persona si se conoce. */
  locale: string;
  dir: TextDirection;
  /** De dónde salió el idioma: elección de la persona, teléfono, país o respaldo global. */
  source: "user" | "device" | "country" | "fallback";
}

/**
 * Resolución del idioma y el locale (ADR 0216). Orden: elección manual → idioma del teléfono → idioma por defecto del
 * país → respaldo global. La región para formatos sale del teléfono si habla el mismo idioma (es-PE), si no del país,
 * si no la por defecto del idioma.
 */
export function resolveLocale(input: {
  pref?: Lang | "system" | null; deviceLocales?: readonly (string | null | undefined)[]; countryLocale?: string | null;
}): ResolvedLocale {
  const devices = (input.deviceLocales ?? []).filter((d): d is string => typeof d === "string" && d.length > 0);
  let lang: Lang;
  let source: ResolvedLocale["source"];
  const deviceMatch = devices.find((d) => isSupportedLang(baseLanguage(d)));
  if (input.pref && input.pref !== "system" && isSupportedLang(input.pref)) {
    lang = input.pref; source = "user";
  } else if (deviceMatch) {
    lang = baseLanguage(deviceMatch) as Lang; source = "device";
  } else if (input.countryLocale && isSupportedLang(baseLanguage(input.countryLocale))) {
    lang = baseLanguage(input.countryLocale) as Lang; source = "country";
  } else {
    lang = GLOBAL_FALLBACK[0]!; source = "fallback";
  }
  const sameLangDevice = devices.find((d) => baseLanguage(d) === lang && regionOf(d));
  const region = regionOf(sameLangDevice)
    ?? (input.countryLocale && baseLanguage(input.countryLocale) === lang ? regionOf(input.countryLocale) : null)
    ?? regionOf(input.countryLocale)
    ?? regionOf(LANGUAGES[lang].defaultLocale);
  return { lang, locale: region ? `${lang}-${region}` : LANGUAGES[lang].defaultLocale, dir: LANGUAGES[lang].dir, source };
}

/**
 * Mensajes con variables y plurales, sin librerías (ICU simplificado):
 *   "Hola {name}"  ·  "{n, plural, =0 {Sin reportes} one {# reporte} other {# reportes}}"
 * `#` es el número formateado. Una variable ausente queda como está (se nota en pruebas, no rompe la app).
 */
export function formatMessage(template: string, params: Readonly<Record<string, string | number>>, lang: Lang, locale?: string): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    if (open < 0) { out += template.slice(i); break; }
    out += template.slice(i, open);
    const close = matchingBrace(template, open);
    if (close < 0) { out += template.slice(open); break; }
    out += renderPlaceholder(template.slice(open + 1, close), params, lang, locale);
    i = close + 1;
  }
  return out;
}

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return j;
  }
  return -1;
}

function renderPlaceholder(body: string, params: Readonly<Record<string, string | number>>, lang: Lang, locale?: string): string {
  const m = /^\s*(\w+)\s*,\s*plural\s*,(.*)$/s.exec(body);
  if (!m) {
    const name = body.trim();
    const v = params[name];
    return v === undefined ? `{${body}}` : typeof v === "number" ? formatNumber(v, locale ?? LANGUAGES[lang].defaultLocale) : v;
  }
  const n = Number(params[m[1]!]);
  const options = new Map<string, string>();
  const re = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/g;
  let rest = m[2]!;
  for (;;) {
    re.lastIndex = 0;
    const k = re.exec(rest);
    if (!k || k.index !== 0) break;
    const start = k[0].length - 1;
    const end = matchingBrace(rest, start);
    if (end < 0) break;
    options.set(k[1]!, rest.slice(start + 1, end));
    rest = rest.slice(end + 1);
  }
  if (!Number.isFinite(n)) return options.get("other") ?? "";
  const chosen = options.get(`=${n}`) ?? options.get(pluralCategory(lang, n)) ?? options.get("other") ?? "";
  return formatMessage(chosen.replace(/#/g, formatNumber(n, locale ?? LANGUAGES[lang].defaultLocale)), params, lang, locale);
}

// ───────────── Formatos regionales (Intl con respaldo; mismo resultado en app y servidor) ─────────────

export function formatNumber(n: number, locale: string, opts: Intl.NumberFormatOptions = {}): string {
  try {
    return new Intl.NumberFormat(locale, opts).format(n);
  } catch {
    return String(opts.maximumFractionDigits !== undefined ? Number(n.toFixed(opts.maximumFractionDigits)) : n);
  }
}

/** Importe con su moneda (ISO 4217) en el formato del locale: "S/ 12.50", "US$ 3.00". */
export function formatCurrency(amount: number, currency: string, locale: string, opts: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "symbol", ...opts }).format(amount);
  } catch {
    const digits = opts.maximumFractionDigits ?? 2;
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

/** Fecha y hora en el locale y la zona dados; null si el motor no soporta la zona (quien llama elige otra). */
export function formatDateTime(date: Date | string | number, locale: string, opts: Intl.DateTimeFormatOptions & { timeZone?: string } = {}): string | null {
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(date));
  } catch {
    return null;
  }
}

const RELATIVE_FALLBACK: Readonly<Record<Lang, { now: string; ago: (x: string) => string; units: Record<"minute" | "hour" | "day", string> }>> = {
  es: { now: "Ahora", ago: (x) => `Hace ${x}`, units: { minute: "min", hour: "h", day: "d" } },
  en: { now: "Now", ago: (x) => `${x} ago`, units: { minute: "min", hour: "h", day: "d" } },
  pt: { now: "Agora", ago: (x) => `Há ${x}`, units: { minute: "min", hour: "h", day: "d" } },
  fr: { now: "À l'instant", ago: (x) => `Il y a ${x}`, units: { minute: "min", hour: "h", day: "j" } },
};

/**
 * Tiempo transcurrido corto ("Hace 12 min", "3 h ago"). Formato fijo y compacto por idioma, igual en todos los
 * teléfonos (Intl.RelativeTimeFormat cambia de estilo entre motores y versiones).
 */
export function formatTimeAgo(seconds: number, lang: Lang): string {
  const w = RELATIVE_FALLBACK[lang];
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return w.now;
  const [n, unit] = s < 3600 ? [Math.floor(s / 60), "minute"] as const : s < 86_400 ? [Math.floor(s / 3600), "hour"] as const : [Math.floor(s / 86_400), "day"] as const;
  return w.ago(`${n} ${w.units[unit]}`);
}
