import type { AreaSearchResult, BBox, FeedPost, Lang, MediaView } from "@dizaster/contracts";

const WORDS: Record<Lang, { now: string; ago: (x: string) => string; over: (km: string) => string; within: (km: string) => string }> = {
  es: { now: "Ahora", ago: (x) => `Hace ${x}`, over: (km) => `a más de ${km} km`, within: (km) => `a menos de ${km} km` },
  en: { now: "Now", ago: (x) => `${x} ago`, over: (km) => `over ${km} km away`, within: (km) => `within ${km} km` },
  pt: { now: "Agora", ago: (x) => `Há ${x}`, over: (km) => `a mais de ${km} km`, within: (km) => `a menos de ${km} km` },
  fr: { now: "À l'instant", ago: (x) => `Il y a ${x}`, over: (km) => `à plus de ${km} km`, within: (km) => `à moins de ${km} km` },
};

/** "Hace 12 min", "Hace 3 h", "Hace 2 d". */
export function timeAgo(iso: string, lang: Lang, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return WORDS[lang].now;
  const [n, unit] = s < 3600 ? [Math.floor(s / 60), "min"] : s < 86_400 ? [Math.floor(s / 3600), "h"] : [Math.floor(s / 86_400), lang === "fr" ? "j" : "d"];
  return WORDS[lang].ago(`${n} ${unit}`);
}

/** "a menos de 2 km" a partir del tramo que da el servidor ("<2km"). */
export function distanceLabel(bucket: string | null, lang: Lang): string | null {
  if (!bucket) return null;
  const m = /^([<>])(\d+)km$/.exec(bucket);
  if (!m) return null;
  return m[1] === ">" ? WORDS[lang].over(m[2]!) : WORDS[lang].within(m[2]!);
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
