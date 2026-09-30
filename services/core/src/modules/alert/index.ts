import {
  GLOBAL_FALLBACK,
  isSupportedLang,
  localizedText,
  AlertPreferences,
  ApproximateLocationRequest,
  CategorySubscriptionInput,
  MAX_SAVED_ZONES,
  SUPPORTED_LANGS,
  SavedZoneInput,
  type SavedZone,
  type SavedZoneKind,
  NotificationsQuery,
  UpdateAlertPreferences,
  type AlertKind,
  type AlertMatch,
  type Lang,
  type CategorySubscription,
  type NotificationStatus,
  type AlertOrigin,
  type NotificationView,
  type NotificationsResponse,
} from "@dizaster/contracts";
import { H3_RES, h3, h3Center } from "@dizaster/geo-kit";
import type { z } from "zod";
import type { Clock } from "../../platform/clock.js";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { GeoService } from "../geo/index.js";
import type { IdentityService, PushTarget } from "../identity/index.js";
import type { IngestionService } from "../ingestion/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { SocialService } from "../social/index.js";
import {
  DEFAULT_PREFERENCES,
  MATCH_PRIORITY,
  MENTION_LIMITS,
  mentionText,
  moderationNoticeText,
  officialUpdateText,
  OFFICIAL_UPDATE_WINDOW_MINUTES,
  NOTIFIED_MODERATION_ACTIONS_EXCLUDED,
  type ModerationNoticeKind,
  alertText,
  decideAlerts,
  groupText,
  inQuietHours,
  isValidTimezone,
  wants,
  type AlertDecision,
  type SeenState,
} from "./rules.js";
import type { PushMessage, PushSender } from "./push/types.js";

export { ApnsSender, type ApnsConfig } from "./push/apns.js";
export { FcmSender, type FcmConfig, type FcmServiceAccount } from "./push/fcm.js";
export { GuardedSender, LogPushSender, PushGateway, type PushMessage, type PushResult, type PushSender } from "./push/types.js";
export { DEFAULT_PREFERENCES, MENTION_LIMITS, mentionText, alertText, budgetAlertText, costDegradationText, sourceAlertText, opsAlertText, type OpsAlertKey, decideAlerts, groupText, inQuietHours, localMinutes, wants } from "./rules.js";

/** Distancia máxima a la costa para asignar un evento marino a un país en las suscripciones por país. */
export const OFFSHORE_COUNTRY_RADIUS_M = 300_000;

const MAX_SUBSCRIPTIONS = 50;
/** Radio de "cerca de mí" y cuánto vale la última ubicación aproximada (D-16). */
export const NEAR_ME_RADIUS_M = 10_000;
export const LAST_LOCATION_TTL_HOURS = 72;
const FLUSH_BATCH = 1000;

/** Deep link del aviso: el EVENT o, para una mención, el post. */
const subjectUrl = (r: { event_id: string | null; post_id: string | null }) =>
  r.event_id ? `dizaster://event/${r.event_id}` : r.post_id ? `dizaster://post/${r.post_id}` : "dizaster://my-moderation";

interface Recipient { profileId: string; userId: string; match: AlertMatch; prefs: AlertPreferences }

/** Quién reportó un evento (lo da el módulo de reportes; ADR 0223). */
export interface ReporterDirectory {
  reportersOf(q: Queryable, eventId: string): Promise<{ profileId: string; userId: string }[]>;
}

interface PrefRow {
  profile_id: string; enabled: boolean; followed_events: boolean; followed_places: boolean; saved_zones: boolean; near_me: boolean;
  categories: boolean; status_changes: boolean; mentions: boolean;
  min_severity: number; max_per_hour: number; quiet_start: number | null; quiet_end: number | null; timezone: string; lang: Lang;
}

const toPrefs = (r: PrefRow | undefined): AlertPreferences =>
  r
    ? {
        enabled: r.enabled, followedEvents: r.followed_events, followedPlaces: r.followed_places, savedZones: r.saved_zones,
        nearMe: r.near_me, categories: r.categories,
        statusChanges: r.status_changes, mentions: r.mentions, minSeverity: r.min_severity, maxPerHour: r.max_per_hour,
        quietHours: r.quiet_start === null || r.quiet_end === null ? null : { start: r.quiet_start, end: r.quiet_end },
        // Un idioma guardado que esta versión no conoce cae al respaldo global (Language Engine, ADR 0216).
        timezone: r.timezone, lang: isSupportedLang(r.lang) ? r.lang : GLOBAL_FALLBACK[0]!,
      }
    : DEFAULT_PREFERENCES;

/** Reintentos de un aviso push con error temporal (ADR 0177). */
export const PUSH_MAX_RETRIES = 3;

/**
 * Alert Engine (Blueprint §5.10): decide a quién avisar, de qué y cuándo, y entrega por el proveedor push
 * configurado (APNs/FCM directos). Módulo independiente: solo reacciona a eventos de dominio y lee a otros
 * módulos por sus interfaces públicas.
 *
 * Reglas de oro:
 * - Nunca se avisa porque apareció una publicación: solo cuando un EVENT cruza un umbral o cambia de estado.
 * - Cada cambio genera una sola alerta (clave única) y cada persona la recibe una sola vez.
 * - El texto solo lleva datos públicos del EVENT: categoría, lugar contextual, estado, severidad. Nunca quién
 *   reportó (seudónimo o no), sus textos ni coordenadas.
 * - Límite por hora, horas de silencio y agrupación: lo que no se envía como push queda en el historial.
 */
export class AlertService {
  constructor(
    private readonly db: Db,
    private readonly ref: ReferenceData,
    private readonly events: EventService,
    private readonly social: SocialService,
    private readonly identity: IdentityService,
    private readonly geo: GeoService,
    private readonly push: PushSender,
    private readonly clock: Clock,
    private readonly ingestion: Pick<IngestionService, "officialAlertSource">,
    private readonly opts: { ttlHours: number; reporters?: ReporterDirectory } = { ttlHours: 24 },
  ) {}

  /** Plazo por defecto de una alerta sin `expires` de la fuente (ADR 0174). */
  private defaultExpiry(): Date {
    return new Date(this.clock.now().getTime() + this.opts.ttlHours * 3_600_000);
  }

  /**
   * Retención (§13.2, ADR 0165), NO AI REQUIRED. La última ubicación aproximada solo sirve 72 h para "cerca de mí":
   * pasado eso se borra. El historial de avisos se guarda `notificationDays` días (lo leído o no). Las alertas en sí
   * se conservan: su `dedup_key` evita repetir un aviso sobre un evento largo.
   */
  async applyRetention(notificationDays: number): Promise<{ lastLocations: number; notifications: number }> {
    const loc = await this.db.query(`DELETE FROM alert.last_locations WHERE seen_at < now() - interval '72 hours'`);
    const notif = await this.db.query(
      `DELETE FROM alert.notifications WHERE created_at < now() - make_interval(days => $1) AND status <> 'PENDING'`, [notificationDays],
    );
    return { lastLocations: loc.rowCount ?? 0, notifications: notif.rowCount ?? 0 };
  }

  registerHandlers(dispatcher: OutboxDispatcher): void {
    const run = (eventId: string, tx: Queryable) => this.evaluate(tx, eventId).then(() => undefined);
    dispatcher.on("EventCreated", "alert.evaluate.created", (e, tx) => run(e.payload.eventId, tx));
    dispatcher.on("EventPublished", "alert.evaluate.published", (e, tx) => run(e.payload.eventId, tx));
    dispatcher.on("EventEvidenceAdded", "alert.evaluate.evidence", (e, tx) => run(e.payload.eventId, tx));
    dispatcher.on("VerificationChanged", "alert.evaluate.verification", (e, tx) => run(e.payload.eventId, tx));
    dispatcher.on("EventLifecycleChanged", "alert.evaluate.lifecycle", (e, tx) => run(e.payload.eventId, tx));
    // Gravedad recalculada (ADR 0160): si subió a alta avisa SEVERITY_UP; si bajó, solo actualiza el estado.
    dispatcher.on("EventSeverityChanged", "alert.evaluate.severity", (e, tx) => run(e.payload.eventId, tx));
    dispatcher.on("UserMentioned", "alert.mention", (e, tx) => this.mention(tx, e.payload).then(() => undefined));
    // Avisos de moderación a la persona afectada (ADR 0141). Una reversión llega como decisión de apelación.
    dispatcher.on("ModerationActionTaken", "alert.moderation-notice", async (e, tx) => {
      const p = e.payload;
      if (!p.affectedUserId || p.reverses || NOTIFIED_MODERATION_ACTIONS_EXCLUDED.includes(p.action)) return;
      await this.moderationNotice(tx, p.affectedUserId, `MODERATION:${p.actionId}`, "ACTION");
    });
    dispatcher.on("OfficialUpdatePosted", "alert.official-update", (e, tx) => this.officialUpdate(tx, e.payload).then(() => undefined));
    dispatcher.on("AppealDecided", "alert.appeal-notice", async (e, tx) => {
      await this.moderationNotice(tx, e.payload.appellantUserId, `APPEAL:${e.payload.appealId}`, e.payload.outcome);
    });
    // Borrado de cuenta (ADR 0021): no queda rastro de qué zonas o temas seguía la persona.
    dispatcher.on("AccountDeleted", "alert.purge-account", async (e, tx) => {
      await tx.query(`DELETE FROM alert.notifications WHERE profile_id = $1`, [e.payload.profileId]);
      // Menciones que escribió: sus avisos a otras personas se van con la cuenta.
      await tx.query(
        `DELETE FROM alert.notifications WHERE alert_id IN (SELECT id FROM alert.alerts WHERE actor_profile_id = $1)`, [e.payload.profileId],
      );
      await tx.query(`DELETE FROM alert.alerts WHERE actor_profile_id = $1`, [e.payload.profileId]);
      await tx.query(`DELETE FROM alert.subscriptions WHERE profile_id = $1`, [e.payload.profileId]);
      await tx.query(`DELETE FROM alert.preferences WHERE profile_id = $1`, [e.payload.profileId]);
      await tx.query(`DELETE FROM alert.zones WHERE profile_id = $1`, [e.payload.profileId]);
      await tx.query(`DELETE FROM alert.last_locations WHERE profile_id = $1`, [e.payload.profileId]);
    });
  }

  /**
   * Aviso de moderación (ADR 0141): pasa por la cola (horas de silencio, agrupación, historial) y lleva a "mis
   * avisos". Nunca nombra a quien denunció. Idempotente por acción o apelación.
   */
  async moderationNotice(tx: Queryable, userId: string, dedupKey: string, kind: ModerationNoticeKind): Promise<number> {
    const profile = await this.social.profileForUser(tx, userId).catch(() => null);
    if (!profile) return 0;
    const prefs = (await this.prefsFor(tx, [profile.id])).get(profile.id) ?? DEFAULT_PREFERENCES;
    if (!wants(prefs, "MODERATION", "MODERATION_NOTICE", 0)) return 0;
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO alert.alerts (id, kind, dedup_key, critical) VALUES ($1, 'MODERATION', $2, false)
       ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [newId(), dedupKey],
    );
    const alertId = inserted.rows[0]?.id;
    if (!alertId) return 0;
    const text = moderationNoticeText(prefs.lang, kind);
    await tx.query(
      `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body) VALUES ($1, $2, $3, $4, 'MODERATION_NOTICE', $5, $6)`,
      [newId(), alertId, profile.id, userId, text.title, text.body],
    );
    await publish(tx, "AlertTriggered", { alertId, eventId: null, kind: "MODERATION" }, { lane: "interactive" });
    return 1;
  }

  /**
   * Actualización oficial (ADR 0157): avisa a quien sigue el evento y a quien ya recibió avisos de él, con sus
   * preferencias (cambios de estado, eventos seguidos, silencio). Como mucho un aviso por evento cada
   * `OFFICIAL_UPDATE_WINDOW_MINUTES`: una institución que publica seguido no genera una ráfaga. NO AI REQUIRED.
   */
  async officialUpdate(tx: Queryable, p: { postId: string; eventId: string; institutionName: string }): Promise<number> {
    const snap = await this.events.alertSnapshot(tx, p.eventId);
    if (!snap || snap.mergedIntoId || snap.publicationState !== "PUBLISHED") return 0;
    const found = new Map<string, { userId: string; match: AlertMatch }>();
    for (const f of await this.social.followersOf(tx, { eventId: snap.id, placeIds: [] })) found.set(f.profileId, { userId: f.userId, match: "FOLLOWED_EVENT" });
    const prior = await tx.query<{ profile_id: string; user_id: string }>(
      `SELECT DISTINCT n.profile_id, n.user_id FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id WHERE a.event_id = $1 AND a.kind <> 'OFFICIAL_UPDATE'`,
      [snap.id],
    );
    for (const r of prior.rows) if (!found.has(r.profile_id)) found.set(r.profile_id, { userId: r.user_id, match: "PREVIOUSLY_ALERTED" });
    for (const r of (await this.opts.reporters?.reportersOf(tx, snap.id)) ?? []) {
      const cur = found.get(r.profileId);
      if (!cur || cur.match === "PREVIOUSLY_ALERTED") found.set(r.profileId, { userId: r.userId, match: "REPORTED" });
    }
    if (found.size === 0) return 0;
    const prefs = await this.prefsFor(tx, [...found.keys()]);
    const recipients = [...found.entries()]
      .map(([profileId, v]) => ({ profileId, ...v, prefs: prefs.get(profileId) ?? DEFAULT_PREFERENCES }))
      .filter((r) => wants(r.prefs, "OFFICIAL_UPDATE", r.match, snap.severity));
    if (recipients.length === 0) return 0;
    const bucket = Math.floor(this.clock.now().getTime() / (OFFICIAL_UPDATE_WINDOW_MINUTES * 60_000));
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO alert.alerts (id, kind, dedup_key, event_id, post_id, critical, origin, expires_at)
       VALUES ($1, 'OFFICIAL_UPDATE', $2, $3, $4, false, 'OFFICIAL', $5)
       ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [newId(), `OFFICIAL_UPDATE:${snap.id}:${bucket}`, snap.id, p.postId, this.defaultExpiry()],
    );
    const alertId = inserted.rows[0]?.id;
    if (!alertId) return 0;
    const res = await tx.query(
      `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body)
       SELECT id, $1, p, u, m, t, b FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::text[]) AS x(id, p, u, m, t, b)
       ON CONFLICT (profile_id, alert_id) DO NOTHING`,
      [
        alertId, recipients.map(() => newId()), recipients.map((r) => r.profileId), recipients.map((r) => r.userId), recipients.map((r) => r.match),
        recipients.map((r) => officialUpdateText(r.prefs.lang, p.institutionName).title), recipients.map((r) => officialUpdateText(r.prefs.lang, p.institutionName).body),
      ],
    );
    if (res.rowCount) await publish(tx, "AlertTriggered", { alertId, eventId: snap.id, kind: "OFFICIAL_UPDATE" }, { lane: "interactive" });
    return res.rowCount ?? 0;
  }

  // ───────────── Decidir ─────────────

  /** Compara el EVENT con lo último visto y crea las alertas y notificaciones que correspondan. Idempotente. */
  async evaluate(tx: Queryable, eventId: string): Promise<number> {
    const snap = await this.events.alertSnapshot(tx, eventId);
    if (!snap || snap.mergedIntoId) return 0;
    const category = this.ref.category(snap.categoryCode, snap.countryCode);
    const prevRow = (await tx.query<{ public_state: string; severity: number; status: string; announced: boolean }>(
      `SELECT public_state, severity, status, announced FROM alert.event_state WHERE event_id = $1 FOR UPDATE`, [eventId],
    )).rows[0];
    const prev: SeenState | null = prevRow
      ? { publicState: prevRow.public_state, severity: prevRow.severity, status: prevRow.status, announced: prevRow.announced }
      : null;
    const decisions = decideAlerts(prev, {
      id: snap.id, severity: snap.severity, publicState: snap.publicState, publicationState: snap.publicationState,
      status: snap.status, categoryAlertable: category?.alertable ?? false,
    });
    await tx.query(
      `INSERT INTO alert.event_state (event_id, public_state, severity, status, announced) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET public_state = $2, severity = $3, status = $4,
         announced = alert.event_state.announced OR $5, updated_at = now()`,
      [eventId, snap.publicState, snap.severity, snap.status, decisions.some((d) => d.kind === "NEW_EVENT")],
    );

    // Campos CAP (ADR 0174): OFFICIAL solo con confirmación oficial; vence cuando lo dice la fuente o al plazo por defecto.
    const official = decisions.length && snap.publicState === "OFFICIALLY_CONFIRMED" ? await this.ingestion.officialAlertSource(tx, eventId) : null;
    const origin = snap.publicState === "OFFICIALLY_CONFIRMED" ? "OFFICIAL" : "SYSTEM";
    const sourceEnd = official?.endsAt ? new Date(official.endsAt) : null;
    const expiresAt = sourceEnd && sourceEnd > this.clock.now() ? sourceEnd : this.defaultExpiry();

    let created = 0;
    for (const d of decisions) {
      const alertId = newId();
      const ins = await tx.query(
        `INSERT INTO alert.alerts (id, event_id, kind, dedup_key, category_code, severity, public_state, place_label, critical, origin, expires_at, cap_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (dedup_key) DO NOTHING`,
        [alertId, eventId, d.kind, d.dedupKey, snap.categoryCode, snap.severity, snap.publicState, snap.place?.label ?? null, d.critical,
          origin, expiresAt, official?.capRef ?? null],
      );
      if (!ins.rowCount) continue;
      created++;
      const recipients = await this.recipients(tx, snap, d);
      if (recipients.length === 0) continue;
      const text = (lang: Lang) =>
        alertText(lang, {
          kind: d.kind, category: localizedText(category?.names, lang) ?? snap.categoryCode, place: snap.place?.label ?? null,
          state: snap.publicState, severity: snap.severity,
        });
      const texts = Object.fromEntries(SUPPORTED_LANGS.map((l) => [l, text(l)])) as Record<Lang, ReturnType<typeof text>>;
      await tx.query(
        `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body)
         SELECT id, $1, p, u, m, t, b FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::text[]) AS x(id, p, u, m, t, b)
         ON CONFLICT (profile_id, alert_id) DO NOTHING`,
        [
          alertId, recipients.map(() => newId()), recipients.map((r) => r.profileId), recipients.map((r) => r.userId),
          recipients.map((r) => r.match), recipients.map((r) => texts[r.prefs.lang].title), recipients.map((r) => texts[r.prefs.lang].body),
        ],
      );
      await publish(tx, "AlertTriggered", { alertId, eventId, kind: d.kind }, { lane: d.critical ? "urgent" : "interactive" });
    }
    return created;
  }

  /**
   * Aviso de mención (D-MENTION, ADR 0063). Pasa por la misma cola que los EVENTs, así que respeta horas de
   * silencio, límite por hora, agrupación e idioma. Una alerta por post (clave única) y una notificación por
   * persona: nunca dos avisos por la misma mención. Anti-spam por autor y por pareja autor→persona.
   */
  async mention(tx: Queryable, m: { postId: string; authorProfileId: string; profileIds: string[] }): Promise<number> {
    const ctx = await this.social.mentionContext(tx, m.postId, m.profileIds);
    if (!ctx || ctx.recipients.length === 0) return 0;
    const now = this.clock.now();
    const sent = await tx.query<{ profile_id: string; n: number }>(
      `SELECT n.profile_id, count(*)::int AS n FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
        WHERE a.actor_profile_id = $1 AND a.kind = 'MENTION' AND a.created_at > $2::timestamptz - interval '24 hours'
          AND a.post_id <> $3
        GROUP BY n.profile_id`,
      [m.authorProfileId, now, m.postId],
    );
    const lastHour = (await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
        WHERE a.actor_profile_id = $1 AND a.kind = 'MENTION' AND a.created_at > $2::timestamptz - interval '1 hour' AND a.post_id <> $3`,
      [m.authorProfileId, now, m.postId],
    )).rows[0]!.n;
    const perPair = new Map(sent.rows.map((r) => [r.profile_id, r.n]));
    const room = Math.max(0, MENTION_LIMITS.perAuthorPerHour - lastHour);
    const candidates = ctx.recipients.filter((p) => (perPair.get(p) ?? 0) < MENTION_LIMITS.perPairPerDay).slice(0, room);
    if (candidates.length === 0) return 0;
    const prefs = await this.prefsFor(tx, candidates);
    const users = await this.social.userIdsForProfiles(tx, candidates);
    const recipients = candidates
      .map((profileId) => ({ profileId, userId: users.get(profileId), prefs: prefs.get(profileId) ?? DEFAULT_PREFERENCES }))
      .filter((r): r is { profileId: string; userId: string; prefs: AlertPreferences } => !!r.userId && wants(r.prefs, "MENTION", "MENTIONED", 0));
    if (recipients.length === 0) return 0;

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO alert.alerts (id, kind, dedup_key, post_id, actor_profile_id, critical)
       VALUES ($1, 'MENTION', $2, $3, $4, false)
       ON CONFLICT (dedup_key) DO UPDATE SET dedup_key = EXCLUDED.dedup_key RETURNING id`,
      [newId(), `MENTION:${m.postId}`, m.postId, m.authorProfileId],
    );
    const alertId = inserted.rows[0]!.id;
    const texts = Object.fromEntries(SUPPORTED_LANGS.map((l) => [l, mentionText(l, ctx.authorHandle)])) as Record<Lang, { title: string; body: string }>;
    const res = await tx.query(
      `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body)
       SELECT id, $1, p, u, 'MENTIONED', t, b FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[]) AS x(id, p, u, t, b)
       ON CONFLICT (profile_id, alert_id) DO NOTHING`,
      [
        alertId, recipients.map(() => newId()), recipients.map((r) => r.profileId), recipients.map((r) => r.userId),
        recipients.map((r) => texts[r.prefs.lang].title), recipients.map((r) => texts[r.prefs.lang].body),
      ],
    );
    if (res.rowCount) await publish(tx, "AlertTriggered", { alertId, eventId: null, kind: "MENTION" }, { lane: "interactive" });
    return res.rowCount ?? 0;
  }

  /** Quién recibe una alerta y por qué (el motivo más directo si hay varios), filtrado por sus preferencias. */
  private async recipients(
    tx: Queryable,
    snap: NonNullable<Awaited<ReturnType<EventService["alertSnapshot"]>>>,
    d: AlertDecision,
  ): Promise<Recipient[]> {
    const found = new Map<string, { userId: string; match: AlertMatch }>();
    const add = (profileId: string, userId: string, match: AlertMatch) => {
      const cur = found.get(profileId);
      if (!cur || MATCH_PRIORITY.indexOf(match) < MATCH_PRIORITY.indexOf(cur.match)) found.set(profileId, { userId, match });
    };
    // El distrito solo existe si el EVENT lo publica (HIGHLY_SENSITIVE no): seguirlo nunca revela más que el mapa.
    const placeIds = [snap.regionId, snap.cityId, snap.districtId].filter((x): x is string => !!x);
    // Área oficial afectada (ADR 0087): también avisa a quien sigue o se suscribió a un área que la alerta cubre,
    // aunque el punto del evento caiga fuera. Solo la dan fuentes externas/oficiales: no revela nada ciudadano.
    const areaJson = snap.affectedArea ? JSON.stringify(snap.affectedArea) : null;
    if (d.kind === "NEW_EVENT" && snap.affectedArea) {
      for (const id of await this.geo.areasIntersecting(tx, snap.affectedArea)) if (!placeIds.includes(id)) placeIds.push(id);
    }
    if (d.kind === "NEW_EVENT") {
      for (const f of await this.social.followersOf(tx, { eventId: snap.id, placeIds })) add(f.profileId, f.userId, f.via === "EVENT" ? "FOLLOWED_EVENT" : "FOLLOWED_PLACE");
      // Un sismo o tsunami mar adentro no pertenece a ningún país, pero afecta a la costa más cercana.
      const country = snap.countryCode ?? this.geo.countryOf(snap.point, OFFSHORE_COUNTRY_RADIUS_M);
      const areas = [...placeIds, ...(country ? [country] : [])];
      const subs = await tx.query<{ profile_id: string }>(
        `SELECT DISTINCT profile_id FROM alert.subscriptions
          WHERE ($1 = category_code OR $1 LIKE category_code || '.%') AND area_id = ANY($2) AND min_severity <= $3`,
        [snap.categoryCode, areas, snap.severity],
      );
      // Zonas guardadas y "cerca de mí": se mide desde la ubicación pública del EVENT (ya generalizada según su
      // sensibilidad), así que una zona nunca revela más que el mapa.
      const near = await tx.query<{ profile_id: string; match: "SAVED_ZONE" | "NEAR_ME" }>(
        `WITH area AS (SELECT CASE WHEN $5::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)::geography END AS g)
         SELECT DISTINCT profile_id, 'SAVED_ZONE' AS match FROM alert.zones, area
          WHERE (ST_DWithin(center, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, radius_m)
                 OR (area.g IS NOT NULL AND ST_DWithin(center, area.g, radius_m)))
            -- Preferencias de la zona (ADR 0154): gravedad mínima y categorías (vacío = todas).
            AND min_severity <= $6
            AND (cardinality(categories) = 0 OR EXISTS (SELECT 1 FROM unnest(categories) c WHERE $7 = c OR $7 LIKE c || '.%'))
         UNION
         SELECT profile_id, 'NEAR_ME' FROM alert.last_locations, area
          WHERE seen_at > now() - make_interval(hours => $3)
            AND (ST_DWithin(center, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
                 OR (area.g IS NOT NULL AND ST_DWithin(center, area.g, 0)))`,
        [snap.point.lng, snap.point.lat, LAST_LOCATION_TTL_HOURS, NEAR_ME_RADIUS_M, areaJson, snap.severity, snap.categoryCode],
      );
      const users = await this.social.userIdsForProfiles(tx, [...subs.rows, ...near.rows].map((r) => r.profile_id));
      for (const r of subs.rows) { const u = users.get(r.profile_id); if (u) add(r.profile_id, u, "CATEGORY"); }
      for (const r of near.rows) { const u = users.get(r.profile_id); if (u) add(r.profile_id, u, r.match); }
    } else {
      for (const f of await this.social.followersOf(tx, { eventId: snap.id, placeIds: [] })) add(f.profileId, f.userId, "FOLLOWED_EVENT");
      // Quien ya recibió un aviso de este evento merece saber si se confirmó, resultó falso o terminó.
      const prior = await tx.query<{ profile_id: string; user_id: string }>(
        `SELECT DISTINCT n.profile_id, n.user_id FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id WHERE a.event_id = $1`,
        [snap.id],
      );
      for (const r of prior.rows) add(r.profile_id, r.user_id, "PREVIOUSLY_ALERTED");
      // Quien reportó se entera de lo que pasó con su reporte (§8.1, ADR 0223).
      for (const r of (await this.opts.reporters?.reportersOf(tx, snap.id)) ?? []) add(r.profileId, r.userId, "REPORTED");
    }
    if (found.size === 0) return [];
    const prefs = await this.prefsFor(tx, [...found.keys()]);
    return [...found.entries()]
      .map(([profileId, v]) => ({ profileId, ...v, prefs: prefs.get(profileId) ?? DEFAULT_PREFERENCES }))
      .filter((r) => wants(r.prefs, d.kind, r.match, snap.severity));
  }

  private async prefsFor(q: Queryable, profileIds: string[]): Promise<Map<string, AlertPreferences>> {
    const { rows } = await q.query<PrefRow>(`SELECT * FROM alert.preferences WHERE profile_id = ANY($1)`, [profileIds]);
    return new Map(rows.map((r) => [r.profile_id, toPrefs(r)]));
  }

  // ───────────── Entregar ─────────────

  /**
   * Entrega lo pendiente. Por persona: horas de silencio (salvo críticas), límite por hora y agrupación
   * (varias alertas a la vez = un solo aviso con resumen). Decide y guarda en una transacción; envía después,
   * fuera de ella, y marca como FAILED lo que ningún dispositivo aceptó.
   */
  async flush(): Promise<Record<NotificationStatus, number>> {
    const now = this.clock.now();
    const units: { ids: string[]; status: NotificationStatus; messages: PushMessage[] }[] = [];
    const counts: Record<NotificationStatus, number> = {
      PENDING: 0, SENT: 0, GROUPED: 0, SILENT_RATE_LIMIT: 0, SILENT_QUIET_HOURS: 0, NO_DEVICE: 0, FAILED: 0, EXPIRED: 0,
    };

    await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{
        id: string; profile_id: string; user_id: string; title: string; body: string; event_id: string | null; post_id: string | null; critical: boolean;
        expires_at: Date | null;
      }>(
        `SELECT n.id, n.profile_id, n.user_id, n.title, n.body, a.event_id, a.post_id, a.critical, a.expires_at
           FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
          WHERE n.status = 'PENDING' AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= $1)
          ORDER BY a.critical DESC, n.created_at, n.id
          LIMIT ${FLUSH_BATCH}
          FOR UPDATE OF n SKIP LOCKED`,
        [now],
      );
      if (rows.length === 0) return;
      const profiles = [...new Set(rows.map((r) => r.profile_id))];
      const prefs = await this.prefsFor(tx, profiles);
      const recent = new Map(
        (await tx.query<{ profile_id: string; n: number }>(
          `SELECT profile_id, count(DISTINCT coalesce(group_id, id))::int AS n FROM alert.notifications
            WHERE profile_id = ANY($1) AND pushed_at > $2::timestamptz - interval '1 hour' GROUP BY profile_id`,
          [profiles, now],
        )).rows.map((r) => [r.profile_id, r.n]),
      );
      const unread = new Map(
        (await tx.query<{ profile_id: string; n: number }>(
          `SELECT profile_id, count(*)::int AS n FROM alert.notifications WHERE profile_id = ANY($1) AND read_at IS NULL GROUP BY profile_id`,
          [profiles],
        )).rows.map((r) => [r.profile_id, r.n]),
      );
      const devices = new Map<string, PushTarget[]>();
      for (const t of await this.identity.pushTargets(tx, [...new Set(rows.map((r) => r.user_id))])) {
        devices.set(t.userId, [...(devices.get(t.userId) ?? []), t]);
      }

      const status = new Map<string, { status: NotificationStatus; groupId: string | null; pushed: boolean }>();
      for (const profileId of profiles) {
        const p = prefs.get(profileId) ?? DEFAULT_PREFERENCES;
        let items = rows.filter((r) => r.profile_id === profileId);
        const set = (list: typeof items, s: NotificationStatus, groupId: string | null = null) =>
          list.forEach((r) => status.set(r.id, { status: s, groupId, pushed: s === "SENT" || s === "GROUPED" }));

        // Vencida antes de salir (cola atrasada): queda en el historial sin sonar (ADR 0174).
        set(items.filter((r) => r.expires_at !== null && r.expires_at <= now), "EXPIRED");
        items = items.filter((r) => r.expires_at === null || r.expires_at > now);
        if (inQuietHours(now, p)) {
          set(items.filter((r) => !r.critical), "SILENT_QUIET_HOURS");
          items = items.filter((r) => r.critical);
        }
        if ((recent.get(profileId) ?? 0) >= p.maxPerHour) {
          set(items.filter((r) => !r.critical), "SILENT_RATE_LIMIT");
          items = items.filter((r) => r.critical); // una confirmación oficial grave nunca se silencia
        }
        if (items.length === 0) continue;
        const targets = devices.get(items[0]!.user_id) ?? [];
        if (targets.length === 0) { set(items, "NO_DEVICE"); continue; }

        const lang = p.lang;
        const single = items.length === 1 ? items[0]! : null;
        const groupId = single ? null : newId();
        const content = single ? { title: single.title, body: single.body } : groupText(lang, items.map((r) => r.title));
        const url = single ? subjectUrl(single) : "dizaster://alerts";
        const groupKey = single ? (single.event_id ? `event-${single.event_id}` : single.post_id ? `post-${single.post_id}` : "moderation") : "alerts-summary";
        set(items, single ? "SENT" : "GROUPED", groupId);
        units.push({
          ids: items.map((r) => r.id),
          status: single ? "SENT" : "GROUPED",
          messages: targets.map((t) => ({
            provider: t.provider, token: t.token, environment: t.environment, title: content.title, body: content.body, url, groupKey,
            badge: unread.get(profileId) ?? items.length, critical: items.some((r) => r.critical),
            data: {
              ...(single ? { ...(single.event_id ? { eventId: single.event_id } : single.post_id ? { postId: single.post_id } : {}), notificationId: single.id } : {}),
              kind: single ? (single.event_id ? "event" : single.post_id ? "mention" : "moderation") : "summary",
            },
          })),
        });
      }
      const entries = [...status.entries()];
      await tx.query(
        `UPDATE alert.notifications n SET status = x.s, group_id = x.g, pushed_at = CASE WHEN x.p THEN $4::timestamptz END
           FROM unnest($1::uuid[], $2::text[], $3::uuid[], $5::boolean[]) AS x(id, s, g, p) WHERE n.id = x.id`,
        [entries.map(([id]) => id), entries.map(([, v]) => v.status), entries.map(([, v]) => v.groupId), now, entries.map(([, v]) => v.pushed)],
      );
      for (const [, v] of entries) counts[v.status]++;
    });

    // Envío fuera de la transacción: la red nunca retiene bloqueos de la base de datos.
    const all = units.flatMap((u) => u.messages);
    if (all.length === 0) return counts;
    const results = await this.push.send(all);
    const byMessage = new Map(all.map((m, i) => [m, results[i]!]));
    const failed: string[] = [];
    const retry: string[] = [];
    for (const u of units) {
      for (const m of u.messages) {
        const r = byMessage.get(m)!;
        if (r.invalidToken) await this.identity.dropPushToken(this.db, m.provider, m.token);
      }
      if (!u.messages.some((m) => byMessage.get(m)!.ok)) {
        // Algún dispositivo falló por algo temporal: se reintenta (ADR 0177); si no, queda como FAILED.
        const temporary = u.messages.some((m) => byMessage.get(m)!.retryable && !byMessage.get(m)!.invalidToken);
        (temporary ? retry : failed).push(...u.ids);
        counts[u.status] -= u.ids.length;
        counts[temporary ? "PENDING" : "FAILED"] += u.ids.length;
      }
    }
    if (retry.length) {
      // Espera creciente (15 s, 30 s, 60 s): tres reintentos caben en los 2 minutos del SLO de alertas URGENT.
      // Agotados, FAILED. El vencimiento de la alerta sigue mandando en la próxima vuelta.
      const moved = await this.db.query<{ id: string }>(
        `UPDATE alert.notifications SET status = 'PENDING', group_id = NULL, pushed_at = NULL, attempts = attempts + 1,
                next_attempt_at = $2::timestamptz + make_interval(secs => 15 * power(2, attempts))
          WHERE id = ANY($1) AND attempts < $3 RETURNING id`,
        [retry, now, PUSH_MAX_RETRIES],
      );
      const kept = new Set(moved.rows.map((r) => r.id));
      const exhausted = retry.filter((id) => !kept.has(id));
      failed.push(...exhausted);
      counts.PENDING -= exhausted.length;
      counts.FAILED += exhausted.length;
    }
    // Ningún dispositivo lo aceptó: queda en el historial y no cuenta para el límite por hora.
    if (failed.length) await this.db.query(`UPDATE alert.notifications SET status = 'FAILED', pushed_at = NULL WHERE id = ANY($1)`, [failed]);
    return counts;
  }

  // ───────────── Historial ─────────────

  async notifications(q: Queryable, profileId: string, raw: unknown): Promise<NotificationsResponse> {
    const f = parse(NotificationsQuery, raw);
    const params: unknown[] = [profileId, f.limit];
    let cursor = "";
    if (f.cursor) {
      const [iso, id] = Buffer.from(f.cursor, "base64url").toString().split("|");
      const at = new Date(iso ?? "");
      if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new DomainError("VALIDATION", "Cursor inválido");
      cursor = `AND (n.created_at, n.id) < ($${params.push(at)}::timestamptz, $${params.push(id)}::uuid)`;
    }
    const { rows } = await q.query<{
      id: string; kind: AlertKind; match: AlertMatch; event_id: string | null; post_id: string | null; category_code: string | null;
      title: string; body: string; created_at: Date; read_at: Date | null; status: NotificationStatus;
      origin: AlertOrigin; expires_at: Date | null; cap_ref: string | null;
    }>(
      `SELECT n.id, a.kind, n.match, a.event_id, a.post_id, a.category_code, n.title, n.body, n.created_at, n.read_at, n.status,
              a.origin, a.expires_at, a.cap_ref
         FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
        WHERE n.profile_id = $1 ${cursor}
        ORDER BY n.created_at DESC, n.id DESC LIMIT $2`,
      params,
    );
    const unread = (await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND read_at IS NULL`, [profileId],
    )).rows[0]!.n;
    const notifications: NotificationView[] = rows.map((r) => ({
      id: r.id, kind: r.kind, match: r.match, eventId: r.event_id, postId: r.post_id, categoryCode: r.category_code, title: r.title, body: r.body,
      url: subjectUrl(r), createdAt: r.created_at.toISOString(), readAt: r.read_at?.toISOString() ?? null, delivery: r.status,
      origin: r.origin, expiresAt: r.expires_at?.toISOString() ?? null, capRef: r.cap_ref,
    }));
    const last = rows[rows.length - 1];
    return {
      notifications, unread,
      nextCursor: rows.length === f.limit && last ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString("base64url") : null,
    };
  }

  /** Marca como leídas (todas si no se indican ids). Devuelve cuántas quedan sin leer. */
  async markRead(q: Queryable, profileId: string, ids: string[] | null): Promise<{ unread: number }> {
    await q.query(
      `UPDATE alert.notifications SET read_at = now() WHERE profile_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`,
      [profileId, ids],
    );
    const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND read_at IS NULL`, [profileId]);
    return { unread: rows[0]!.n };
  }

  // ───────────── Preferencias y suscripciones ─────────────

  async preferences(q: Queryable, profileId: string): Promise<AlertPreferences> {
    return (await this.prefsFor(q, [profileId])).get(profileId) ?? DEFAULT_PREFERENCES;
  }

  async updatePreferences(q: Queryable, profileId: string, raw: unknown): Promise<AlertPreferences> {
    const patch = parse(UpdateAlertPreferences, raw);
    if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) throw new DomainError("VALIDATION", "Zona horaria desconocida");
    const p = AlertPreferences.parse({ ...(await this.preferences(q, profileId)), ...patch });
    await q.query(
      `INSERT INTO alert.preferences (profile_id, enabled, followed_events, followed_places, categories, status_changes, min_severity,
                                      max_per_hour, quiet_start, quiet_end, timezone, lang, saved_zones, near_me, mentions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (profile_id) DO UPDATE SET enabled = $2, followed_events = $3, followed_places = $4, categories = $5,
         status_changes = $6, min_severity = $7, max_per_hour = $8, quiet_start = $9, quiet_end = $10, timezone = $11, lang = $12,
         saved_zones = $13, near_me = $14, mentions = $15, updated_at = now()`,
      [profileId, p.enabled, p.followedEvents, p.followedPlaces, p.categories, p.statusChanges, p.minSeverity, p.maxPerHour,
        p.quietHours?.start ?? null, p.quietHours?.end ?? null, p.timezone, p.lang, p.savedZones, p.nearMe, p.mentions],
    );
    // Apagar "cerca de mí" borra en el acto la última ubicación guardada.
    if (!p.nearMe) await q.query(`DELETE FROM alert.last_locations WHERE profile_id = $1`, [profileId]);
    return p;
  }

  // ───────────── Zonas guardadas y ubicación aproximada (D-16) ─────────────

  async zones(q: Queryable, profileId: string): Promise<SavedZone[]> {
    const { rows } = await q.query<{ id: string; kind: SavedZoneKind; name: string | null; lat: number; lng: number; radius_m: number; min_severity: number; categories: string[] }>(
      `SELECT id, kind, name, ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng, radius_m, min_severity, categories
         FROM alert.zones WHERE profile_id = $1 ORDER BY created_at, id`,
      [profileId],
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, name: r.name, center: { lat: r.lat, lng: r.lng }, radiusKm: r.radius_m / 1000, minSeverity: r.min_severity, categories: r.categories,
    }));
  }

  /** Crea (sin id) o reemplaza una zona. El punto se reduce al centro de su celda H3 r8 antes de guardarlo. */
  async saveZone(q: Queryable, profileId: string, raw: unknown, zoneId?: string): Promise<SavedZone> {
    const z = parse(SavedZoneInput, raw);
    const c = h3Center(h3({ lat: z.lat, lng: z.lng }, H3_RES.SENSITIVE));
    const name = z.name ? z.name : null;
    const unknown = z.categories.find((code) => !this.ref.category(code));
    if (unknown) throw new DomainError("VALIDATION", `Categoría desconocida: ${unknown}`, 400);
    const categories = [...new Set(z.categories)].sort();
    const prefs = { minSeverity: z.minSeverity, categories };
    if (zoneId) {
      const { rowCount } = await q.query(
        `UPDATE alert.zones SET kind = $3, name = $4, center = ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, radius_m = $7,
                min_severity = $8, categories = $9, updated_at = now()
          WHERE id = $1 AND profile_id = $2`,
        [zoneId, profileId, z.kind, name, c.lng, c.lat, z.radiusKm * 1000, z.minSeverity, categories],
      );
      if (!rowCount) throw new DomainError("NOT_FOUND", "Zona no encontrada", 404);
      return { id: zoneId, kind: z.kind, name, center: c, radiusKm: z.radiusKm, ...prefs };
    }
    const id = newId();
    const ins = await q.query(
      `INSERT INTO alert.zones (id, profile_id, kind, name, center, radius_m, min_severity, categories)
       SELECT $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $9, $10
        WHERE (SELECT count(*) FROM alert.zones WHERE profile_id = $2) < $8`,
      [id, profileId, z.kind, name, c.lng, c.lat, z.radiusKm * 1000, MAX_SAVED_ZONES, z.minSeverity, categories],
    );
    if (!ins.rowCount) throw new DomainError("LIMIT_REACHED", `Máximo ${MAX_SAVED_ZONES} zonas`, 409);
    return { id, kind: z.kind, name, center: c, radiusKm: z.radiusKm, ...prefs };
  }

  async deleteZone(q: Queryable, profileId: string, zoneId: string): Promise<void> {
    await q.query(`DELETE FROM alert.zones WHERE id = $1 AND profile_id = $2`, [zoneId, profileId]);
  }

  /**
   * La app la envía al abrirse si la persona activó "cerca de mí". Solo se guarda el centro de la celda H3 r7
   * (~5 km²) y se sobrescribe: no hay historial de dónde estuvo nadie. Sin la preferencia activa no se guarda.
   */
  async setApproximateLocation(q: Queryable, profileId: string, raw: unknown): Promise<{ stored: boolean }> {
    const p = parse(ApproximateLocationRequest, raw);
    if (!(await this.preferences(q, profileId)).nearMe) return { stored: false };
    const c = h3Center(h3(p, H3_RES.ZONE));
    await q.query(
      `INSERT INTO alert.last_locations (profile_id, center, seen_at) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, now())
       ON CONFLICT (profile_id) DO UPDATE SET center = EXCLUDED.center, seen_at = now()`,
      [profileId, c.lng, c.lat],
    );
    return { stored: true };
  }

  async clearApproximateLocation(q: Queryable, profileId: string): Promise<void> {
    await q.query(`DELETE FROM alert.last_locations WHERE profile_id = $1`, [profileId]);
  }

  async subscriptions(q: Queryable, profileId: string): Promise<CategorySubscription[]> {
    const { rows } = await q.query<{ id: string; category_code: string; area_id: string; min_severity: number }>(
      `SELECT id, category_code, area_id, min_severity FROM alert.subscriptions WHERE profile_id = $1 ORDER BY created_at`,
      [profileId],
    );
    const names = new Map((await this.geo.areasByIds(q, rows.map((r) => r.area_id).filter((a) => a.includes(":")))).map((a) => [a.id, a.label]));
    return rows.map((r) => ({
      id: r.id, categoryCode: r.category_code, areaId: r.area_id, minSeverity: r.min_severity,
      areaName: names.get(r.area_id) ?? (r.area_id.includes(":") ? r.area_id : this.geo.countryName(r.area_id)),
    }));
  }

  async addSubscription(q: Queryable, profileId: string, raw: unknown): Promise<CategorySubscription> {
    const s = parse(CategorySubscriptionInput, raw);
    if (!this.ref.category(s.categoryCode, null)) throw new DomainError("VALIDATION", "Categoría desconocida");
    if (s.areaId.includes(":")) {
      if ((await this.geo.areasByIds(q, [s.areaId])).length === 0) throw new DomainError("NOT_FOUND", "Lugar no encontrado", 404);
    } else if (!this.geo.isCountry(s.areaId)) {
      throw new DomainError("VALIDATION", "País desconocido");
    }
    const count = (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM alert.subscriptions WHERE profile_id = $1`, [profileId])).rows[0]!.n;
    if (count >= MAX_SUBSCRIPTIONS) throw new DomainError("LIMIT_REACHED", `Máximo ${MAX_SUBSCRIPTIONS} suscripciones`, 409);
    await q.query(
      `INSERT INTO alert.subscriptions (id, profile_id, category_code, area_id, min_severity) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (profile_id, category_code, area_id) DO UPDATE SET min_severity = EXCLUDED.min_severity`,
      [newId(), profileId, s.categoryCode, s.areaId, s.minSeverity],
    );
    return (await this.subscriptions(q, profileId)).find((x) => x.categoryCode === s.categoryCode && x.areaId === s.areaId)!;
  }

  async removeSubscription(q: Queryable, profileId: string, id: string): Promise<void> {
    await q.query(`DELETE FROM alert.subscriptions WHERE id = $1 AND profile_id = $2`, [id, profileId]);
  }

  // ───────────── Calidad y avisos a administración (ADR 0026) ─────────────

  /** Alertas del periodo, destino de cada aviso y cuánto tardó en salir el push desde que se decidió la alerta. */
  async qualityStats(q: Queryable, from: Date, to: Date) {
    const a = await q.query<{ alerts: number; critical: number }>(
      `SELECT count(*)::int AS alerts, count(*) FILTER (WHERE critical)::int AS critical FROM alert.alerts WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    const n = await q.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM alert.notifications WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
      [from, to],
    );
    const lat = await q.query<{ p50: number | null; p95: number | null; cp95: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY s) AS p95,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY s) FILTER (WHERE critical) AS cp95
         FROM (SELECT EXTRACT(EPOCH FROM (n.pushed_at - a.created_at)) AS s, a.critical
                 FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
                WHERE n.pushed_at IS NOT NULL AND a.created_at >= $1 AND a.created_at < $2) x`,
      [from, to],
    );
    const l = lat.rows[0]!;
    const sec = (v: number | null) => (v === null ? null : Math.round(Number(v) * 10) / 10);
    return {
      alerts: a.rows[0]!.alerts,
      critical: a.rows[0]!.critical,
      notifications: Object.fromEntries(n.rows.map((r) => [r.status, r.n])),
      pushP50Seconds: sec(l.p50),
      pushP95Seconds: sec(l.p95),
      criticalPushP95Seconds: sec(l.cp95),
    };
  }

  /**
   * Aviso operativo a quienes administran (p. ej. un presupuesto llegó a un umbral). Va directo a sus
   * dispositivos, en el idioma de cada persona, y no entra al historial de alertas públicas.
   */
  async notifyAdmins(userIds: string[], text: (lang: Lang) => { title: string; body: string }, url: string, groupKey: string): Promise<number> {
    const targets = await this.identity.pushTargets(this.db, userIds);
    if (targets.length === 0) return 0;
    const langs = new Map<string, Lang>();
    for (const userId of new Set(targets.map((t) => t.userId))) {
      const profile = await this.social.profileForUser(this.db, userId);
      langs.set(userId, (await this.preferences(this.db, profile.id)).lang);
    }
    const messages: PushMessage[] = targets.map((t) => ({
      provider: t.provider, token: t.token, environment: t.environment, ...text(langs.get(t.userId) ?? "es"),
      url, groupKey, badge: 0, critical: false, data: { kind: "ADMIN" },
    }));
    const results = await this.push.send(messages);
    for (const [i, r] of results.entries()) if (r.invalidToken) await this.identity.dropPushToken(this.db, messages[i]!.provider, messages[i]!.token);
    return results.filter((r) => r.ok).length;
  }

  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  async exportData(q: Queryable, profileId: string): Promise<Record<string, unknown[]>> {
    const preferences = await q.query(`SELECT * FROM alert.preferences WHERE profile_id = $1`, [profileId]);
    const subscriptions = await q.query(`SELECT id, category_code, area_id, min_severity, created_at FROM alert.subscriptions WHERE profile_id = $1`, [profileId]);
    const zones = await q.query(
      `SELECT id, kind, name, ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng, radius_m, min_severity, categories, created_at FROM alert.zones WHERE profile_id = $1`, [profileId],
    );
    const lastLocation = await q.query(
      `SELECT ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng, seen_at FROM alert.last_locations WHERE profile_id = $1`, [profileId],
    );
    const notifications = await q.query(
      `SELECT id, alert_id, title, body, status, created_at, pushed_at, read_at FROM alert.notifications WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 5000`, [profileId],
    );
    return { preferences: preferences.rows, subscriptions: subscriptions.rows, zones: zones.rows, lastLocation: lastLocation.rows, notifications: notifications.rows };
  }
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

