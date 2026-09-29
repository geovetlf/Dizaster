import type { AlertKind, AlertMatch, AlertPreferences, PublicVerificationState } from "@dizaster/contracts";

/** Estado público de un EVENT tal como lo ve el Alert Engine. */
export interface EventSnapshot {
  id: string;
  severity: number;
  publicState: PublicVerificationState;
  publicationState: string;
  status: string;
  categoryAlertable: boolean;
}

export interface SeenState {
  publicState: string;
  severity: number;
  status: string;
  announced: boolean;
}

export interface AlertDecision {
  kind: AlertKind;
  dedupKey: string;
  critical: boolean;
}

/** Verificación mínima para avisar de un evento nuevo: nunca por un solo reporte ciudadano sin corroborar. */
const ANNOUNCEABLE = new Set<PublicVerificationState>(["COMMUNITY_CORROBORATED", "EXTERNALLY_CORROBORATED", "OFFICIALLY_CONFIRMED"]);
/** Cambios de estado que merecen aviso a quien sigue (o ya recibió aviso de) el evento. */
export const SIGNIFICANT_STATES = new Set<PublicVerificationState>(["OFFICIALLY_CONFIRMED", "EXTERNALLY_CORROBORATED", "DISPUTED", "FALSE"]);
/** Severidad a partir de la cual una subida se avisa. */
export const HIGH_SEVERITY = 4;

export const DEFAULT_PREFERENCES: AlertPreferences = {
  enabled: true,
  followedEvents: true,
  followedPlaces: true,
  categories: true,
  statusChanges: true,
  minSeverity: 3,
  maxPerHour: 6,
  quietHours: null,
  timezone: "UTC",
  lang: "es",
};

/**
 * Qué alertas produce un EVENT al pasar de `prev` (lo último que se vio) a `snap`. Pura y determinista.
 * Cada decisión lleva una clave única: el mismo cambio nunca genera dos alertas.
 */
export function decideAlerts(prev: SeenState | null, snap: EventSnapshot): AlertDecision[] {
  if (snap.publicationState !== "PUBLISHED") return [];
  const out: AlertDecision[] = [];
  const official = snap.publicState === "OFFICIALLY_CONFIRMED";
  const announceable = snap.categoryAlertable && ANNOUNCEABLE.has(snap.publicState) && snap.status !== "RESOLVED" && snap.status !== "ARCHIVED";
  if (!prev?.announced && announceable) {
    out.push({ kind: "NEW_EVENT", dedupKey: `${snap.id}:NEW`, critical: official && snap.severity >= HIGH_SEVERITY });
    return out; // el aviso de evento nuevo ya cuenta su estado y severidad actuales
  }
  if (prev && prev.publicState !== snap.publicState && SIGNIFICANT_STATES.has(snap.publicState)) {
    out.push({ kind: "STATE_CHANGED", dedupKey: `${snap.id}:STATE:${snap.publicState}`, critical: official && snap.severity >= HIGH_SEVERITY });
  }
  if (prev && snap.severity > prev.severity && snap.severity >= HIGH_SEVERITY && snap.publicState !== "FALSE") {
    out.push({ kind: "SEVERITY_UP", dedupKey: `${snap.id}:SEV:${snap.severity}`, critical: false });
  }
  if (prev && prev.status !== "RESOLVED" && snap.status === "RESOLVED") {
    out.push({ kind: "RESOLVED", dedupKey: `${snap.id}:RESOLVED`, critical: false });
  }
  return out;
}

/** Prioridad cuando una persona coincide por varios motivos: se guarda el más directo. */
export const MATCH_PRIORITY: AlertMatch[] = ["FOLLOWED_EVENT", "FOLLOWED_PLACE", "CATEGORY", "PREVIOUSLY_ALERTED"];

/** ¿Quiere esta persona este aviso según sus preferencias? */
export function wants(p: AlertPreferences, kind: AlertKind, match: AlertMatch, severity: number): boolean {
  if (!p.enabled) return false;
  if (kind !== "NEW_EVENT") {
    if (!p.statusChanges) return false;
    return match === "FOLLOWED_EVENT" ? p.followedEvents : true;
  }
  if (match === "FOLLOWED_EVENT") return p.followedEvents;
  if (severity < p.minSeverity) return false;
  if (match === "FOLLOWED_PLACE") return p.followedPlaces;
  if (match === "CATEGORY") return p.categories;
  return false;
}

/** Minutos desde medianoche en la zona horaria dada. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** ¿Está en horas de silencio? Soporta tramos que cruzan medianoche (22:00–07:00). */
export function inQuietHours(now: Date, p: Pick<AlertPreferences, "quietHours" | "timezone">): boolean {
  if (!p.quietHours || p.quietHours.start === p.quietHours.end) return false;
  const m = localMinutes(now, p.timezone);
  const { start, end } = p.quietHours;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const STATE_TEXT: Record<"es" | "en", Record<PublicVerificationState, string>> = {
  es: {
    UNVERIFIED: "Sin verificar",
    COMMUNITY_CORROBORATED: "Corroborado por la comunidad",
    EXTERNALLY_CORROBORATED: "Confirmado por fuentes externas",
    OFFICIALLY_CONFIRMED: "Confirmado oficialmente",
    DISPUTED: "En disputa",
    FALSE: "Marcado como falso",
  },
  en: {
    UNVERIFIED: "Unverified",
    COMMUNITY_CORROBORATED: "Corroborated by the community",
    EXTERNALLY_CORROBORATED: "Confirmed by external sources",
    OFFICIALLY_CONFIRMED: "Officially confirmed",
    DISPUTED: "Disputed",
    FALSE: "Marked as false",
  },
};

/**
 * Texto del aviso. Solo usa datos públicos: categoría, lugar contextual (ya generalizado según sensibilidad),
 * estado y severidad. Nunca nombres de quien reportó, textos de sus posts ni coordenadas.
 */
export function alertText(
  lang: "es" | "en",
  a: { kind: AlertKind; category: string; place: string | null; state: PublicVerificationState; severity: number },
): { title: string; body: string } {
  const where = a.place ?? "";
  const sev = lang === "es" ? `severidad ${a.severity}/5` : `severity ${a.severity}/5`;
  const state = STATE_TEXT[lang][a.state];
  const join = (...xs: string[]) => xs.filter(Boolean).join(" · ");
  switch (a.kind) {
    case "NEW_EVENT":
      return { title: where ? (lang === "es" ? `${a.category} en ${where}` : `${a.category} in ${where}`) : a.category, body: join(state, sev) };
    case "STATE_CHANGED":
      return { title: `${state}: ${a.category}`, body: join(where, sev) };
    case "SEVERITY_UP":
      return { title: lang === "es" ? `Aumenta la gravedad: ${a.category}` : `Severity up: ${a.category}`, body: join(where, sev) };
    case "RESOLVED":
      return { title: lang === "es" ? `Terminado: ${a.category}` : `Over: ${a.category}`, body: where || state };
  }
}

/** Resumen cuando hay varias alertas a la vez: un solo aviso en lugar de una ráfaga. */
export function groupText(lang: "es" | "en", titles: string[]): { title: string; body: string } {
  const n = titles.length;
  const shown = titles.slice(0, 3).join(" · ");
  return {
    title: lang === "es" ? `${n} alertas nuevas` : `${n} new alerts`,
    body: n > 3 ? `${shown} ${lang === "es" ? `y ${n - 3} más` : `and ${n - 3} more`}` : shown,
  };
}
