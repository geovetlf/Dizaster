import type { AreaSearchResult, BBox, FeedPost, Lang, MediaView, Units } from "@dizaster/contracts";

const WORDS: Record<Lang, { now: string; ago: (x: string) => string; over: (distance: string) => string; within: (distance: string) => string }> = {
  es: { now: "Ahora", ago: (x) => `Hace ${x}`, over: (d) => `a más de ${d}`, within: (d) => `a menos de ${d}` },
  en: { now: "Now", ago: (x) => `${x} ago`, over: (d) => `over ${d} away`, within: (d) => `within ${d}` },
  pt: { now: "Agora", ago: (x) => `Há ${x}`, over: (d) => `a mais de ${d}`, within: (d) => `a menos de ${d}` },
  fr: { now: "À l'instant", ago: (x) => `Il y a ${x}`, over: (d) => `à plus de ${d}`, within: (d) => `à moins de ${d}` },
};

let units: Units = "metric";
/** Unidades de la persona (ADR 0044); se fijan al cargar su perfil. */
export function setUnits(u: Units) { units = u; }

/** "5 km" o, en imperial, "3.1 mi". */
export function formatKm(km: number, u: Units = units): string {
  if (u === "metric") return `${km} km`;
  const mi = km * 0.621371;
  return `${mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)} mi`;
}

/** "Hace 12 min", "Hace 3 h", "Hace 2 d". */
export function timeAgo(iso: string, lang: Lang, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return WORDS[lang].now;
  const [n, unit] = s < 3600 ? [Math.floor(s / 60), "min"] : s < 86_400 ? [Math.floor(s / 3600), "h"] : [Math.floor(s / 86_400), lang === "fr" ? "j" : "d"];
  return WORDS[lang].ago(`${n} ${unit}`);
}

/** "a menos de 2 km" a partir del tramo que da el servidor ("<2km"). */
export function distanceLabel(bucket: string | null, lang: Lang, u: Units = units): string | null {
  if (!bucket) return null;
  const m = /^([<>])(\d+)km$/.exec(bucket);
  if (!m) return null;
  const d = formatKm(Number(m[2]), u);
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
