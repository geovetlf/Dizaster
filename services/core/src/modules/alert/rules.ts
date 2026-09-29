import type { AlertKind, AlertMatch, AlertPreferences, Lang, PublicVerificationState } from "@dizaster/contracts";

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
  savedZones: true,
  nearMe: false,
  categories: true,
  statusChanges: true,
  mentions: true,
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
export const MATCH_PRIORITY: AlertMatch[] = ["FOLLOWED_EVENT", "SAVED_ZONE", "NEAR_ME", "FOLLOWED_PLACE", "CATEGORY", "PREVIOUSLY_ALERTED", "MENTIONED"];

/** ¿Quiere esta persona este aviso según sus preferencias? */
export function wants(p: AlertPreferences, kind: AlertKind, match: AlertMatch, severity: number): boolean {
  if (!p.enabled) return false;
  if (kind === "MENTION") return p.mentions;
  if (kind !== "NEW_EVENT") {
    if (!p.statusChanges) return false;
    return match === "FOLLOWED_EVENT" ? p.followedEvents : true;
  }
  if (match === "FOLLOWED_EVENT") return p.followedEvents;
  if (severity < p.minSeverity) return false;
  if (match === "SAVED_ZONE") return p.savedZones;
  if (match === "NEAR_ME") return p.nearMe;
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

const STATE_TEXT: Record<Lang, Record<PublicVerificationState, string>> = {
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
  pt: {
    UNVERIFIED: "Não verificado",
    COMMUNITY_CORROBORATED: "Corroborado pela comunidade",
    EXTERNALLY_CORROBORATED: "Confirmado por fontes externas",
    OFFICIALLY_CONFIRMED: "Confirmado oficialmente",
    DISPUTED: "Em disputa",
    FALSE: "Marcado como falso",
  },
  fr: {
    UNVERIFIED: "Non vérifié",
    COMMUNITY_CORROBORATED: "Corroboré par la communauté",
    EXTERNALLY_CORROBORATED: "Confirmé par des sources externes",
    OFFICIALLY_CONFIRMED: "Confirmé officiellement",
    DISPUTED: "Contesté",
    FALSE: "Signalé comme faux",
  },
};

/** Frases de los avisos por idioma. Un idioma nuevo = una entrada más (el tipo exige todas las frases). */
const PHRASES: Record<Lang, {
  severity: (n: number) => string; inPlace: (c: string, w: string) => string; severityUp: (c: string) => string;
  over: (c: string) => string; newAlerts: (n: number) => string; more: (n: number) => string;
}> = {
  es: {
    severity: (n) => `severidad ${n}/5`, inPlace: (c, w) => `${c} en ${w}`, severityUp: (c) => `Aumenta la gravedad: ${c}`,
    over: (c) => `Terminado: ${c}`, newAlerts: (n) => `${n} alertas nuevas`, more: (n) => `y ${n} más`,
  },
  en: {
    severity: (n) => `severity ${n}/5`, inPlace: (c, w) => `${c} in ${w}`, severityUp: (c) => `Severity up: ${c}`,
    over: (c) => `Over: ${c}`, newAlerts: (n) => `${n} new alerts`, more: (n) => `and ${n} more`,
  },
  pt: {
    severity: (n) => `gravidade ${n}/5`, inPlace: (c, w) => `${c} em ${w}`, severityUp: (c) => `Gravidade aumentou: ${c}`,
    over: (c) => `Encerrado: ${c}`, newAlerts: (n) => `${n} novos alertas`, more: (n) => `e mais ${n}`,
  },
  fr: {
    severity: (n) => `gravité ${n}/5`, inPlace: (c, w) => `${c} à ${w}`, severityUp: (c) => `Gravité en hausse : ${c}`,
    over: (c) => `Terminé : ${c}`, newAlerts: (n) => `${n} nouvelles alertes`, more: (n) => `et ${n} de plus`,
  },
};

/**
 * Texto del aviso. Solo usa datos públicos: categoría, lugar contextual (ya generalizado según sensibilidad),
 * estado y severidad. Nunca nombres de quien reportó, textos de sus posts ni coordenadas.
 */
export function alertText(
  lang: Lang,
  a: { kind: AlertKind; category: string; place: string | null; state: PublicVerificationState; severity: number },
): { title: string; body: string } {
  const t = PHRASES[lang];
  const where = a.place ?? "";
  const sev = t.severity(a.severity);
  const state = STATE_TEXT[lang][a.state];
  const join = (...xs: string[]) => xs.filter(Boolean).join(" · ");
  switch (a.kind) {
    case "NEW_EVENT":
      return { title: where ? t.inPlace(a.category, where) : a.category, body: join(state, sev) };
    case "STATE_CHANGED":
      return { title: `${state}: ${a.category}`, body: join(where, sev) };
    case "SEVERITY_UP":
      return { title: t.severityUp(a.category), body: join(where, sev) };
    case "RESOLVED":
      return { title: t.over(a.category), body: where || state };
    case "MENTION":
      return mentionText(lang, null);
  }
}

/** Resumen cuando hay varias alertas a la vez: un solo aviso en lugar de una ráfaga. */
export function groupText(lang: Lang, titles: string[]): { title: string; body: string } {
  const n = titles.length;
  const shown = titles.slice(0, 3).join(" · ");
  return { title: PHRASES[lang].newAlerts(n), body: n > 3 ? `${shown} ${PHRASES[lang].more(n - 3)}` : shown };
}

/** Aviso a administración cuando un presupuesto llega a un umbral (ADR 0026). Montos en USD, sin datos personales. */
const BUDGET_TEXT: Record<Lang, (key: string, pct: number, spent: string, limit: string) => { title: string; body: string }> = {
  es: (k, p, s, l) => ({ title: `Presupuesto ${k} al ${p}%`, body: `Gastado US$ ${s} de US$ ${l}.${p >= 100 ? " La función se detuvo." : ""}` }),
  en: (k, p, s, l) => ({ title: `Budget ${k} at ${p}%`, body: `Spent US$ ${s} of US$ ${l}.${p >= 100 ? " The feature has stopped." : ""}` }),
  pt: (k, p, s, l) => ({ title: `Orçamento ${k} em ${p}%`, body: `Gasto US$ ${s} de US$ ${l}.${p >= 100 ? " A função foi interrompida." : ""}` }),
  fr: (k, p, s, l) => ({ title: `Budget ${k} à ${p} %`, body: `Dépensé ${s} US$ sur ${l} US$.${p >= 100 ? " La fonction est arrêtée." : ""}` }),
};

const SOURCE_TEXT: Record<Lang, (key: string, down: boolean) => { title: string; body: string }> = {
  es: (k, d) => d ? { title: `Fuente urgente caída: ${k}`, body: "Falló 3 veces seguidas; se reintentará sola. Revisa el panel de calidad." } : { title: `Fuente urgente recuperada: ${k}`, body: "Vuelve a consultarse con normalidad." },
  en: (k, d) => d ? { title: `Urgent source down: ${k}`, body: "It failed 3 times in a row; it will retry on its own. Check the quality dashboard." } : { title: `Urgent source recovered: ${k}`, body: "It is being polled normally again." },
  pt: (k, d) => d ? { title: `Fonte urgente fora do ar: ${k}`, body: "Falhou 3 vezes seguidas; tentará de novo sozinha. Veja o painel de qualidade." } : { title: `Fonte urgente recuperada: ${k}`, body: "Voltou a ser consultada normalmente." },
  fr: (k, d) => d ? { title: `Source urgente en panne : ${k}`, body: "Trois échecs de suite ; nouvel essai automatique. Consultez le tableau de qualité." } : { title: `Source urgente rétablie : ${k}`, body: "Elle est de nouveau interrogée normalement." },
};

export function sourceAlertText(lang: Lang, s: { sourceKey: string; state: "DEGRADED" | "RECOVERED" }): { title: string; body: string } {
  return SOURCE_TEXT[lang](s.sourceKey, s.state === "DEGRADED");
}

/** Alertas operativas (ADR 0130): SLO incumplido o outbox atascado, y su recuperación. */
export type OpsAlertKey = "api_p95" | "urgent_chain_p95" | "moderation_oldest_open" | "outbox_oldest_pending";
const OPS_NAME: Record<Lang, Record<OpsAlertKey, string>> = {
  es: { api_p95: "Latencia de la API (p95)", urgent_chain_p95: "Cadena urgente oficial (p95)", moderation_oldest_open: "Caso de moderación más antiguo", outbox_oldest_pending: "Eventos internos pendientes" },
  en: { api_p95: "API latency (p95)", urgent_chain_p95: "Official urgent chain (p95)", moderation_oldest_open: "Oldest moderation case", outbox_oldest_pending: "Pending internal events" },
  pt: { api_p95: "Latência da API (p95)", urgent_chain_p95: "Cadeia urgente oficial (p95)", moderation_oldest_open: "Caso de moderação mais antigo", outbox_oldest_pending: "Eventos internos pendentes" },
  fr: { api_p95: "Latence de l'API (p95)", urgent_chain_p95: "Chaîne urgente officielle (p95)", moderation_oldest_open: "Plus ancien cas de modération", outbox_oldest_pending: "Événements internes en attente" },
};
const OPS_TEXT: Record<Lang, (name: string, breached: boolean, observed: string, target: string) => { title: string; body: string }> = {
  es: (n, b, o, t) => b ? { title: `Objetivo incumplido: ${n}`, body: `Medido ${o}, objetivo ${t}. Revisa el panel de calidad y los runbooks.` } : { title: `Objetivo recuperado: ${n}`, body: `Medido ${o}, objetivo ${t}.` },
  en: (n, b, o, t) => b ? { title: `Target missed: ${n}`, body: `Measured ${o}, target ${t}. Check the quality dashboard and runbooks.` } : { title: `Target recovered: ${n}`, body: `Measured ${o}, target ${t}.` },
  pt: (n, b, o, t) => b ? { title: `Meta descumprida: ${n}`, body: `Medido ${o}, meta ${t}. Veja o painel de qualidade e os runbooks.` } : { title: `Meta recuperada: ${n}`, body: `Medido ${o}, meta ${t}.` },
  fr: (n, b, o, t) => b ? { title: `Objectif manqué : ${n}`, body: `Mesuré ${o}, objectif ${t}. Consultez le tableau de qualité et les runbooks.` } : { title: `Objectif rétabli : ${n}`, body: `Mesuré ${o}, objectif ${t}.` },
};
export function opsAlertText(lang: Lang, a: { key: OpsAlertKey; breached: boolean; observed: number; target: number; unit: string }): { title: string; body: string } {
  const fmt = (v: number) => `${Math.round(v)} ${a.unit}`;
  return OPS_TEXT[lang](OPS_NAME[lang][a.key], a.breached, fmt(a.observed), fmt(a.target));
}

export function budgetAlertText(lang: Lang, b: { key: string; threshold: number; spentUsd: number; limitUsd: number }): { title: string; body: string } {
  return BUDGET_TEXT[lang](b.key, b.threshold, b.spentUsd.toFixed(2), b.limitUsd.toFixed(2));
}

const DEGRADATION_TEXT: Record<Lang, (feature: string, killed: boolean, pct: number) => { title: string; body: string }> = {
  es: (f, k, p) => ({ title: k ? `Presupuesto de infraestructura al ${p}%: "${f}" pausado` : `"${f}" restaurado`, body: k ? "Degradación automática por costo. Reportes y alertas siguen activos." : `El gasto de infraestructura bajó al ${p}%.` }),
  en: (f, k, p) => ({ title: k ? `Infrastructure budget at ${p}%: "${f}" paused` : `"${f}" restored`, body: k ? "Automatic cost degradation. Reports and alerts stay on." : `Infrastructure spend is back to ${p}%.` }),
  pt: (f, k, p) => ({ title: k ? `Orçamento de infraestrutura em ${p}%: "${f}" pausado` : `"${f}" restaurado`, body: k ? "Degradação automática por custo. Relatos e alertas continuam ativos." : `O gasto de infraestrutura voltou a ${p}%.` }),
  fr: (f, k, p) => ({ title: k ? `Budget d'infrastructure à ${p} % : « ${f} » en pause` : `« ${f} » rétabli`, body: k ? "Dégradation automatique liée au coût. Signalements et alertes restent actifs." : `Les dépenses d'infrastructure sont revenues à ${p} %.` }),
};

/** Aviso de degradación automática por costo (ADR 0138). NO AI REQUIRED. */
export function costDegradationText(lang: Lang, d: { feature: string; killed: boolean; percent: number }): { title: string; body: string } {
  return DEGRADATION_TEXT[lang](d.feature, d.killed, Math.round(d.percent));
}

/**
 * Anti-spam de menciones (ADR 0063). Por encima de estos topes la mención sigue en el post, pero no genera aviso:
 * una cuenta no puede usar @ para inundar de notificaciones a nadie.
 */
export const MENTION_LIMITS = {
  /** Personas distintas a las que una misma cuenta puede avisar por mención en una hora. */
  perAuthorPerHour: 20,
  /** Avisos de la misma cuenta a la misma persona en 24 h. */
  perPairPerDay: 3,
} as const;

const MENTION_TEXT: Record<Lang, (who: string | null) => { title: string; body: string }> = {
  es: (w) => ({ title: w ? `@${w} te mencionó` : "Te mencionaron en una publicación", body: "Toca para ver la publicación." }),
  en: (w) => ({ title: w ? `@${w} mentioned you` : "You were mentioned in a post", body: "Tap to see the post." }),
  pt: (w) => ({ title: w ? `@${w} mencionou você` : "Você foi mencionado em uma publicação", body: "Toque para ver a publicação." }),
  fr: (w) => ({ title: w ? `@${w} vous a mentionné` : "Vous avez été mentionné dans une publication", body: "Touchez pour voir la publication." }),
};

/** Texto del aviso de mención. Nunca incluye el texto del post; un post seudónimo no nombra a su autor. */
export function mentionText(lang: Lang, authorHandle: string | null): { title: string; body: string } {
  return MENTION_TEXT[lang](authorHandle);
}
