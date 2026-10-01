import { formatDateTime, formatTimeAgo, LANGUAGES, type AreaSearchResult, type BBox, type FeedPost, type Lang, type MediaView, type Units } from "@dizaster/contracts";

const WORDS: Record<Lang, { over: (distance: string) => string; within: (distance: string) => string }> = {
  es: { over: (d) => `a más de ${d}`, within: (d) => `a menos de ${d}` },
  en: { over: (d) => `over ${d} away`, within: (d) => `within ${d}` },
  pt: { over: (d) => `a mais de ${d}`, within: (d) => `a menos de ${d}` },
  fr: { over: (d) => `à plus de ${d}`, within: (d) => `à moins de ${d}` },
};

let units: Units = "metric";
/** Unidades de la persona (ADR 0044); se fijan al cargar su perfil. */
export function setUnits(u: Units) { units = u; }

/** "Hace 12 min", "Hace 3 h", "Hace 2 d" (Language Engine, ADR 0216). */
export function timeAgo(iso: string, lang: Lang, now = new Date()): string {
  return formatTimeAgo((now.getTime() - new Date(iso).getTime()) / 1000, lang);
}

let regionalLocale: string | null = null;
/** Locale de formatos de la app (idioma + región, p. ej. "es-PE"); lo fija i18n al resolver el idioma. */
export function setFormatLocale(l: string | null) { regionalLocale = l; }
/** Locale para fechas y números en `lang`: el resuelto si es del mismo idioma, si no el por defecto del idioma. */
export function localeFor(lang: Lang): string {
  return regionalLocale && regionalLocale.split("-")[0] === lang ? regionalLocale : LANGUAGES[lang].defaultLocale;
}

/** Número con el separador decimal de la región (ADR 0285): "3,1" en fr-FR o pt-BR, "3.1" en es-PE o en-US. */
function num(n: number, lang?: Lang): string {
  const locale = lang ? localeFor(lang) : regionalLocale ?? "en";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
}

/** "5 km" o, en imperial, "3,1 mi" / "3.1 mi" según la región. */
export function formatKm(km: number, u: Units = units, lang?: Lang): string {
  if (u === "metric") return `${num(km, lang)} km`;
  const mi = km * 0.621371;
  return `${num(mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi), lang)} mi`;
}

/** Tramos cortos en metros ("<100m"): en imperial, pies redondeados a decenas (100 m → 330 ft). */
function formatMeters(m: number, u: Units, lang?: Lang): string {
  if (u === "metric") return `${num(m, lang)} m`;
  return `${num(Math.round((m * 3.28084) / 10) * 10, lang)} ft`;
}

/** "a menos de 2 km" a partir del tramo que da el servidor ("<2km", "<500m", ">2km"). */
export function distanceLabel(bucket: string | null, lang: Lang, u: Units = units): string | null {
  if (!bucket) return null;
  const m = /^([<>])(\d+)(km|m)$/.exec(bucket);
  if (!m) return null;
  const d = m[3] === "km" ? formatKm(Number(m[2]), u, lang) : formatMeters(Number(m[2]), u, lang);
  return m[1] === ">" ? WORDS[lang].over(d) : WORDS[lang].within(d);
}

/**
 * Línea de contexto de una publicación: "Hace 12 min • Miraflores, Lima". El lugar es el contextual del
 * evento (derivado de su ubicación pública); si no hay, se muestra el tramo de distancia.
 */
export function postWhere(post: Pick<FeedPost, "createdAt" | "place" | "distanceBucket">, lang: Lang, now = new Date()): string {
  return [timeAgo(post.createdAt, lang, now), post.place?.label ?? distanceLabel(post.distanceBucket, lang)].filter(Boolean).join(" • ");
}

/** Resultado de lugar para la búsqueda: "Miraflores" / "Distrito · Lima, Perú". */
export function areaRow(a: Pick<AreaSearchResult, "name" | "label" | "kind">): { title: string; subtitle: string } {
  const rest = a.label.startsWith(`${a.name}, `) ? a.label.slice(a.name.length + 2) : a.label;
  return { title: a.name, subtitle: [a.kind, rest].filter(Boolean).join(" · ") };
}

/** bbox ⇄ parámetro de ruta ("w,s,e,n"), para abrir el mapa encuadrado en un lugar. */
export const bboxParam = (b: BBox) => b.map((n) => n.toFixed(4)).join(",");
export function parseBboxParam(v: string | string[] | undefined): BBox | null {
  const parts = (Array.isArray(v) ? v[0] : v)?.split(",").map(Number);
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts as [number, number, number, number];
  return s <= n && w >= -180 && e <= 180 && s >= -90 && n <= 90 ? [w, s, e, n] : null;
}

/** "0:24" para la duración de un video. */
export function duration(ms: number | null): string {
  const s = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Iniciales para el avatar cuando no hay foto de perfil. */
export function initials(name: string): string {
  // Solo palabras de 2+ letras: "dev_1a2b" da "D", no letras sueltas de un identificador.
  const parts = name.replace(/[_\d]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 2);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Disposición de la media de un post como en la referencia: una sola a lo ancho; varias en un mosaico con
 * la primera grande, hasta dos a la derecha y "+N" con el resto.
 */
export function mediaLayout(media: MediaView[]): { main: MediaView | null; side: MediaView[]; extra: number } {
  if (media.length === 0) return { main: null, side: [], extra: 0 };
  return { main: media[0]!, side: media.slice(1, 3), extra: Math.max(0, media.length - 3) };
}

/**
 * Qué versión cargar: las celdas pequeñas del mosaico usan la miniatura (≤ 400 px), que pesa una fracción;
 * lo que ocupa el ancho de la pantalla usa la versión de pantalla. Menos datos para quien mira y menos CDN.
 */
export const imageUri = (m: Pick<MediaView, "url" | "thumbUrl">, size: "small" | "large") => (size === "small" ? (m.thumbUrl ?? m.url) : m.url);

/** Título de un evento en el idioma de la app; si no existe, el primero disponible y, al final, la categoría. */
export function eventTitle(e: { title: Record<string, string> | null; categoryCode: string }, lang: string): string {
  return e.title?.[lang] ?? (e.title ? Object.values(e.title)[0] : undefined) ?? e.categoryCode;
}

/** Imagen de fondo (difuminada) del aviso de contenido sensible: la miniatura, que es lo más liviano. */
export function blurPreviewUri(m: Pick<MediaView, "kind" | "url" | "thumbUrl">): string | null {
  return m.thumbUrl ?? (m.kind === "IMAGE" ? m.url : null);
}

/** Formatea en una zona horaria; null si el motor de JS no la soporta (el llamador cae a la hora del teléfono). */
export function formatInZone(iso: string, lang: Lang, timeZone: string | undefined, style: "datetime" | "time"): string | null {
  const opts: Intl.DateTimeFormatOptions = style === "time"
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  return formatDateTime(iso, localeFor(lang), timeZone ? { ...opts, timeZone } : opts);
}

/**
 * Hora de algo que pasó en un evento (ADR 0079, Blueprint §5.15): en la zona del evento y, si la de la persona es
 * otra, también en la suya: "14:05 hora local · 16:05 tu hora". Sin zona del evento, solo la del teléfono.
 */
export function eventTime(
  iso: string, lang: Lang, eventTz: string | null | undefined, labels: { local: string; yours: string },
  style: "datetime" | "time" = "datetime", deviceTz: string | undefined = deviceTimeZone(),
): string {
  const mine = formatInZone(iso, lang, deviceTz, style) ?? formatInZone(iso, lang, undefined, style) ?? iso;
  if (!eventTz || eventTz === deviceTz) return mine;
  const there = formatInZone(iso, lang, eventTz, style);
  if (!there || there === mine) return mine;
  return `${there} ${labels.local} · ${mine} ${labels.yours}`;
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
