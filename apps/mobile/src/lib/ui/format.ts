import type { MediaView } from "@dizaster/contracts";

type Lang = "es" | "en";

/** "Hace 12 min", "Hace 3 h", "Hace 2 d". */
export function timeAgo(iso: string, lang: Lang, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return lang === "es" ? "Ahora" : "Now";
  const [n, unit] = s < 3600 ? [Math.floor(s / 60), "min"] : s < 86_400 ? [Math.floor(s / 3600), "h"] : [Math.floor(s / 86_400), "d"];
  return lang === "es" ? `Hace ${n} ${unit}` : `${n} ${unit} ago`;
}

/** "a menos de 2 km" a partir del tramo que da el servidor ("<2km"). */
export function distanceLabel(bucket: string | null, lang: Lang): string | null {
  if (!bucket) return null;
  const m = /^([<>])(\d+)km$/.exec(bucket);
  if (!m) return null;
  if (m[1] === ">") return lang === "es" ? `a más de ${m[2]} km` : `over ${m[2]} km away`;
  return lang === "es" ? `a menos de ${m[2]} km` : `within ${m[2]} km`;
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
