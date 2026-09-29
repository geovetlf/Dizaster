import type { Lang, NotificationStatus } from "@dizaster/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ruta interna a la que lleva un aviso. Solo se aceptan los destinos que envía el servidor
 * (dizaster://event/<id>, dizaster://alerts y, para administración, dizaster://admin-cost): un aviso nunca
 * puede abrir una ruta arbitraria.
 */
export function routeForNotificationUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /^dizaster:\/\/(event\/([^/?#]+)|alerts|admin-cost)\/?$/.exec(url.trim());
  if (!m) return null;
  if (m[1] === "alerts") return "/alerts";
  if (m[1] === "admin-cost") return "/admin-cost";
  return m[2] && UUID.test(m[2]) ? `/event/${m[2].toLowerCase()}` : null;
}

/** Estado del permiso tal como lo necesita la interfaz: pedirlo, ya concedido, o solo desde Ajustes del sistema. */
export type PermissionView = "granted" | "ask" | "blocked";

export function permissionView(p: { granted: boolean; canAskAgain: boolean }): PermissionView {
  if (p.granted) return "granted";
  // iOS solo muestra el diálogo una vez; Android 13+ deja de mostrarlo tras dos rechazos.
  return p.canAskAgain ? "ask" : "blocked";
}

/** 1320 → "22:00". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Opciones de horas de silencio. Tramos fijos: más simple que un selector de hora y cubre los casos habituales. */
export const QUIET_PRESETS: ({ start: number; end: number } | null)[] = [
  null,
  { start: 22 * 60, end: 7 * 60 },
  { start: 23 * 60, end: 6 * 60 },
  { start: 0, end: 8 * 60 },
];

export const quietLabel = (q: { start: number; end: number } | null, off: string) => (q ? `${formatMinutes(q.start)}–${formatMinutes(q.end)}` : off);

export const sameQuiet = (a: { start: number; end: number } | null, b: { start: number; end: number } | null) =>
  a === b || (!!a && !!b && a.start === b.start && a.end === b.end);

/** Siguiente valor de una lista cíclica (para filas que se tocan para cambiar de opción). */
export function cycle<T>(options: readonly T[], current: T, eq: (a: T, b: T) => boolean = Object.is): T {
  const i = options.findIndex((o) => eq(o, current));
  return options[(i + 1) % options.length]!;
}

/** Qué hay que corregir en el servidor para que los avisos respeten la hora y el idioma del teléfono. */
export function devicePrefsPatch(
  prefs: { timezone: string; lang: Lang },
  device: { timezone: string | null | undefined; lang: Lang },
): { timezone?: string; lang?: Lang } | null {
  const patch: { timezone?: string; lang?: Lang } = {};
  if (device.timezone && device.timezone !== prefs.timezone) patch.timezone = device.timezone;
  if (device.lang !== prefs.lang) patch.lang = device.lang;
  return Object.keys(patch).length ? patch : null;
}

/** Aclaración que se muestra en el historial cuando una alerta no sonó. */
export function deliveryNoteKey(status: NotificationStatus): "deliveryQuiet" | "deliveryRateLimit" | "deliveryNoDevice" | "deliveryFailed" | null {
  switch (status) {
    case "SILENT_QUIET_HOURS": return "deliveryQuiet";
    case "SILENT_RATE_LIMIT": return "deliveryRateLimit";
    case "NO_DEVICE": return "deliveryNoDevice";
    case "FAILED": return "deliveryFailed";
    default: return null;
  }
}

/** Texto del contador de la campana: nunca más de dos cifras. */
export const badgeText = (n: number) => (n <= 0 ? null : n > 99 ? "99+" : String(n));

/** "Cerca de mí": como mucho un envío cada 30 minutos aunque la app se abra muchas veces. */
export const NEAR_ME_MIN_INTERVAL_MS = 30 * 60_000;

export function shouldSendNearMe(enabled: boolean, lastSentAt: number | null, now: number): boolean {
  return enabled && (lastSentAt === null || now - lastSentAt >= NEAR_ME_MIN_INTERVAL_MS);
}

/** La app redondea antes de enviar (~1 km); el servidor además solo guarda la celda H3 r7. */
export const roundForUpload = (p: { lat: number; lng: number }) => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });

/** Icono y texto de cada tipo de zona guardada. */
export const ZONE_KINDS = [
  { kind: "HOME", icon: "home-outline", label: "zoneHOME" },
  { kind: "WORK", icon: "briefcase-outline", label: "zoneWORK" },
  { kind: "FAMILY", icon: "account-heart-outline", label: "zoneFAMILY" },
  { kind: "SCHOOL", icon: "school-outline", label: "zoneSCHOOL" },
  { kind: "OTHER", icon: "map-marker-radius-outline", label: "zoneOTHER" },
] as const;

export type ZoneKindInfo = (typeof ZONE_KINDS)[number];
export const zoneKindInfo = (kind: string): ZoneKindInfo => ZONE_KINDS.find((k) => k.kind === kind) ?? ZONE_KINDS[4];

/** Nombre visible de una zona: el suyo si lo tiene, si no el de su tipo. */
export const zoneTitle = (z: { kind: string; name: string | null }, kindLabel: (key: ZoneKindInfo["label"]) => string) =>
  z.name?.trim() || kindLabel(zoneKindInfo(z.kind).label);
