import { createHash } from "node:crypto";
import type { AreaGeometry, CategoryCode, EventCandidate, EventSourceView, GeoPoint, LocalizedText } from "@dizaster/contracts";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService, ResolutionResult } from "../event/index.js";
import type { GeoService } from "../geo/index.js";

export { FEED_ADAPTERS, type FeedAdapter } from "./adapters/index.js";
export { InstitutionService, INSTITUTION_ADAPTER, institutionSourceKey } from "./institution.js";
export { IngestionScheduler, NodeHttpFetcher, lastScheduledAt, resolveSourceUrl, type HttpFetcher, type FetchResult, type RunSummary, type PushResult, pushSecretName, pushSignature, PUSH_TOLERANCE_S } from "./scheduler.js";

/** Ítem ya normalizado al esquema común, independiente del formato de la fuente. */
export interface NormalizedItem {
  externalId: string;
  categoryCode: CategoryCode;
  /** Sin coordenadas no se inventa una: el ítem queda sin mapa (IGNORED para el mapa). */
  point: GeoPoint | null;
  uncertaintyM: number;
  occurredAt: string;
  publishedAt: string | null;
  title: LocalizedText | null;
  /** Enlace público al ítem original, si la fuente lo da (se muestra en la ficha del evento). */
  link?: string | null;
  /** Hasta cuándo vale la alerta según la fuente (CAP `expires`). Pasado eso, deja de sostener el evento. */
  endsAt?: string | null;
  severity: number | null;
  /** NOT_OCCURRING = la fuente niega/desmiente el acontecimiento. */
  assertion: "OCCURRING" | "NOT_OCCURRING";
  /** Geocódigos oficiales del área (CAP `<geocode>`): sirven para ubicar el ítem si no trae coordenadas (ADR 0077). */
  geocodes?: { scheme: string; value: string }[];
  /** Área oficial afectada tal como la da la fuente (CAP `<polygon>`/`<circle>`, ADR 0087). */
  area?: AreaGeometry;
  /** Declaración sobre un EVENT concreto (institución oficial, ADR 0095): se adjunta solo a ese evento o falla. */
  targetEventId?: string;
  raw: Record<string, unknown>;
}

/**
 * Un adapter por FORMATO de fuente (USGS GeoJSON, CAP, GDACS RSS...). Añadir una fuente con un formato
 * existente es solo configuración en data/source-registry. Los adapters llegan en la etapa de ingestión.
 */
export interface SourceAdapter {
  readonly adapterType: string;
  fetch(ctx: { config: Record<string, unknown>; etag: string | null; since: Date | null }): AsyncIterable<Record<string, unknown>>;
  normalize(raw: Record<string, unknown>): NormalizedItem | null;
}

export interface SourceRow {
  id: string;
  key: string;
  type: "OFFICIAL" | "EXTERNAL" | "OPEN_DATA" | "NEWS" | "API" | "SENSOR";
  trust_tier: "EXTERNAL" | "OFFICIAL";
  status: string;
}

const ORIGIN_BY_TYPE: Record<SourceRow["type"], EventCandidate["origin"]> = {
  OFFICIAL: "OFFICIAL",
  EXTERNAL: "EXTERNAL",
  OPEN_DATA: "OPEN_DATA",
  NEWS: "NEWS",
  API: "EXTERNAL",
  SENSOR: "SENSOR",
};

export class IngestionService {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly geo: GeoService | null = null,
  ) {}

  /** Sincroniza el registro de fuentes (datos versionados) con la base de datos. */
  async syncRegistry(sources: Array<Record<string, unknown>>): Promise<void> {
    for (const s of sources) {
      await this.db.query(
        `INSERT INTO ingestion.sources (id, key, name, type, trust_tier, country_scope, categories, adapter, config, license, terms_url,
                                        schedule_normal, urgent_capable, urgent_poll_seconds, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, trust_tier = EXCLUDED.trust_tier,
           country_scope = EXCLUDED.country_scope, categories = EXCLUDED.categories, adapter = EXCLUDED.adapter, config = EXCLUDED.config,
           license = EXCLUDED.license, terms_url = EXCLUDED.terms_url, schedule_normal = EXCLUDED.schedule_normal,
           urgent_capable = EXCLUDED.urgent_capable, urgent_poll_seconds = EXCLUDED.urgent_poll_seconds, updated_at = now()`,
        [
          newId(), s["key"], s["name"], s["type"], s["trustTier"], s["countryScope"], s["categories"], s["adapter"],
          JSON.stringify(s["config"] ?? {}), s["license"] ?? null, s["termsUrl"] ?? null, s["scheduleNormal"] ?? null,
          s["urgentCapable"] ?? false, s["urgentPollSeconds"] ?? null, s["status"],
        ],
      );
    }
  }

  async setSourceStatus(key: string, status: "ACTIVE" | "PAUSED" | "PLANNED" | "RESEARCH" | "RETIRED"): Promise<void> {
    await this.db.query(`UPDATE ingestion.sources SET status = $2, updated_at = now() WHERE key = $1`, [key, status]);
  }

  /**
   * Punto de entrada común de los carriles NORMAL y URGENT. Idempotente por (fuente, id externo).
   */
  async ingest(sourceKey: string, item: NormalizedItem, lane: "NORMAL" | "URGENT", rawRef: string | null = null): Promise<{ externalItemId: string; resolution: ResolutionResult | null; duplicate: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const source = (await tx.query<SourceRow>(`SELECT id, key, type, trust_tier, status FROM ingestion.sources WHERE key = $1`, [sourceKey])).rows[0];
      if (!source) throw new DomainError("UNKNOWN_SOURCE", `Fuente no registrada: ${sourceKey}`);
      if (source.status !== "ACTIVE") throw new DomainError("SOURCE_NOT_ACTIVE", `La fuente ${sourceKey} no está activa`);

      const hash = createHash("sha256").update(JSON.stringify(item)).digest("hex");
      const existing = (await tx.query<{ id: string; content_hash: string; status: string }>(
        `SELECT id, content_hash, status FROM ingestion.external_items WHERE source_id = $1 AND external_id = $2`,
        [source.id, item.externalId],
      )).rows[0];
      // Un ítem en ERROR se reintenta aunque no haya cambiado (el fallo pudo ser del catálogo o del índice).
      if (existing && existing.content_hash === hash && existing.status !== "ERROR") {
        // Sin cambios: solo se actualiza a qué crudo pertenece la última vez que se vio (ADR 0075).
        if (rawRef) await tx.query(`UPDATE ingestion.external_items SET raw_ref = $2 WHERE id = $1`, [existing.id, rawRef]);
        return { externalItemId: existing.id, resolution: null, duplicate: true };
      }

      // Sin coordenadas pero con geocódigos oficiales: se ubica con el índice local (nunca se inventa un punto).
      // El hash se calcula sobre lo que mandó la fuente, así un ítem repetido no vuelve a consultar el índice.
      const located = !item.point && item.geocodes?.length && this.geo ? await this.geo.locateGeocodes(tx, item.geocodes) : null;
      if (located) {
        item = {
          ...item, point: located.point, uncertaintyM: Math.max(item.uncertaintyM, located.radiusM),
          ...(located.area && !item.area ? { area: located.area } : {}),
          raw: { ...item.raw, locatedBy: "GEOCODE", areaIds: located.areaIds },
        };
      }

      const itemId = existing?.id ?? newId();
      if (existing) {
        await tx.query(`UPDATE ingestion.external_items SET content_hash = $2, normalized = $3, lane = $4, fetched_at = now(), ends_at = $5, raw_ref = coalesce($6, raw_ref), error = NULL WHERE id = $1`, [
          itemId, hash, JSON.stringify(item), lane, item.endsAt ?? null, rawRef,
        ]);
      } else {
        await tx.query(
          `INSERT INTO ingestion.external_items (id, source_id, external_id, content_hash, lane, assertion, published_at, normalized, status, ends_at, raw_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW', $9, $10)`,
          [itemId, source.id, item.externalId, hash, lane, item.assertion, item.publishedAt, JSON.stringify(item), item.endsAt ?? null, rawRef],
        );
      }
      await publish(tx, "ExternalItemIngested", { externalItemId: itemId, sourceId: source.id, lane }, { lane: lane === "URGENT" ? "urgent" : "batch" });

      if (!item.point) {
        await tx.query(`UPDATE ingestion.external_items SET status = 'IGNORED' WHERE id = $1`, [itemId]);
        return { externalItemId: itemId, resolution: null, duplicate: false };
      }
      const resolution = await this.events.resolveCandidate(tx, {
        origin: ORIGIN_BY_TYPE[source.type],
        originRef: { kind: "EXTERNAL_ITEM", id: itemId },
        categoryCode: item.categoryCode,
        point: item.point,
        locationUncertaintyM: item.uncertaintyM,
        occurredAt: item.occurredAt,
        observedAt: item.publishedAt ?? item.occurredAt,
        ...(item.severity ? { severityHint: item.severity } : {}),
        ...(item.title ? { title: item.title } : {}),
        trustTier: source.trust_tier,
        weight: 1,
        mayCreateEvent: item.assertion === "OCCURRING" && !item.targetEventId,
        ...(item.targetEventId ? { userSelectedEventId: item.targetEventId } : {}),
        createAsPending: false,
        externalIds: [item.externalId],
        mediaHashes: [],
        metadata: { assertion: item.assertion, sourceKey },
        ...(item.area ? { affectedArea: item.area } : {}),
      });
      if (item.targetEventId && !(resolution.kind === "ATTACHED" && resolution.confidence === "USER_SELECTED")) {
        // Deshace todo (ítem y evidencia): una declaración nunca cae en otro evento por deduplicación.
        throw new DomainError("INVALID_TARGET", resolution.kind === "INVALID_TARGET" ? resolution.reason : "No se puede declarar sobre ese evento", 409);
      }
      const eventId = resolution.kind === "CREATED" || resolution.kind === "ATTACHED" ? resolution.eventId : null;
      await tx.query(`UPDATE ingestion.external_items SET status = $2, event_id = $3 WHERE id = $1`, [itemId, eventId ? "MAPPED" : "IGNORED", eventId]);
      return { externalItemId: itemId, resolution, duplicate: false };
    });
  }

  /**
   * Un ítem que no se pudo procesar (ADR 0155, §7.3 status ERROR): queda registrado con el motivo, sin evento, y el
   * resto del documento sigue. La próxima vez que llegue se reintenta. Solo errores del propio ítem (DomainError);
   * un fallo de infraestructura sigue abortando la corrida.
   */
  async markError(sourceKey: string, item: NormalizedItem, lane: "NORMAL" | "URGENT", rawRef: string | null, message: string): Promise<void> {
    const hash = createHash("sha256").update(JSON.stringify(item)).digest("hex");
    await this.db.query(
      `INSERT INTO ingestion.external_items (id, source_id, external_id, content_hash, lane, assertion, published_at, normalized, status, raw_ref, error)
       SELECT $1, s.id, $3, $4, $5, $6, $7, $8, 'ERROR', $9, left($10, 500) FROM ingestion.sources s WHERE s.key = $2
       ON CONFLICT (source_id, external_id) DO UPDATE SET content_hash = EXCLUDED.content_hash, normalized = EXCLUDED.normalized,
         status = CASE WHEN ingestion.external_items.status IN ('NEW','ERROR') THEN 'ERROR' ELSE ingestion.external_items.status END,
         error = EXCLUDED.error, fetched_at = now(), raw_ref = coalesce(EXCLUDED.raw_ref, ingestion.external_items.raw_ref)`,
      [newId(), sourceKey, item.externalId, hash, lane, item.assertion, item.publishedAt, JSON.stringify(item), rawRef, message],
    );
  }

  /**
   * Para el Verification Engine: confirma que cada ítem viene de una fuente REGISTRADA y con el nivel
   * de confianza registrado (no el que diga la evidencia). Una fuente retirada deja de contar.
   */
  async registeredItems(
    q: Queryable, itemIds: string[], scope?: { categoryCode: string; countryCode: string | null },
  ): Promise<Map<string, { trustTier: "EXTERNAL" | "OFFICIAL"; assertion: string; sourceName: string; at: Date }>> {
    if (itemIds.length === 0) return new Map();
    const { rows } = await q.query<{
      id: string; trust_tier: "EXTERNAL" | "OFFICIAL"; assertion: string; categories: string[]; country_scope: string[]; name: string; at: Date;
    }>(
      `SELECT i.id, s.trust_tier, i.assertion, s.categories, s.country_scope, s.name, coalesce(i.published_at, i.fetched_at) AS at
         FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id
        WHERE i.id = ANY($1) AND s.status IN ('ACTIVE','PAUSED')`,
      [itemIds],
    );
    // Una fuente oficial solo es oficial dentro de su ámbito (D-PTWC): fuera de él cuenta como externa.
    return new Map(rows.map((r) => [r.id, {
      trustTier: r.trust_tier === "OFFICIAL" && (!scope || inOfficialScope(r, scope.categoryCode, scope.countryCode)) ? "OFFICIAL" : "EXTERNAL",
      assertion: r.assertion,
      sourceName: r.name,
      at: r.at,
    }]));
  }

  /** La fuente retiró una alerta (CAP Cancel, ADR 0059). Idempotente; un id desconocido se ignora. */
  async withdraw(sourceKey: string, externalId: string, at: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE ingestion.external_items i SET withdrawn_at = $3
         FROM ingestion.sources s
        WHERE s.id = i.source_id AND s.key = $1 AND i.external_id = $2 AND i.withdrawn_at IS NULL`,
      [sourceKey, externalId, at],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Ítems vinculados a un evento cuya vigencia terminó (retirados o expirados) en la ventana dada, con el motivo.
   * Solo los recientes: un evento viejo ya lo cerró el ciclo por inactividad.
   */
  /**
   * Fusión, reversión y división de eventos (§6.2, ADR 0149): cada ítem externo apunta al evento donde está su
   * evidencia, igual que los reportes. De esto depende, p. ej., "una declaración por institución y evento".
   */
  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("EventMerged", "ingestion.follow-merge", async (e, tx) => {
      await tx.query(`UPDATE ingestion.external_items SET event_id = $1 WHERE event_id = $2`, [e.payload.targetEventId, e.payload.mergedEventId]);
    });
    dispatcher.on("EventMergeReverted", "ingestion.follow-merge-revert", async (e, tx) => {
      await tx.query(`UPDATE ingestion.external_items SET event_id = $1 WHERE id::text = ANY($2) AND event_id = $3`, [
        e.payload.restoredEventId, e.payload.evidenceRefIds, e.payload.targetEventId,
      ]);
    });
    dispatcher.on("EventSplit", "ingestion.follow-split", async (e, tx) => {
      await tx.query(`UPDATE ingestion.external_items SET event_id = $1 WHERE id::text = ANY($2) AND event_id = $3`, [
        e.payload.newEventId, e.payload.evidenceRefIds, e.payload.sourceEventId,
      ]);
    });
  }

  async endedItems(q: Queryable, now: Date, windowDays = 7): Promise<{ id: string; reason: "WITHDRAWN" | "EXPIRED"; at: Date }[]> {
    const { rows } = await q.query<{ id: string; reason: "WITHDRAWN" | "EXPIRED"; at: Date }>(
      `SELECT id, CASE WHEN withdrawn_at IS NOT NULL THEN 'WITHDRAWN' ELSE 'EXPIRED' END AS reason, coalesce(withdrawn_at, ends_at) AS at
         FROM ingestion.external_items
        WHERE event_id IS NOT NULL AND coalesce(withdrawn_at, ends_at) <= $1
          AND coalesce(withdrawn_at, ends_at) > $1::timestamptz - make_interval(days => $2)`,
      [now, windowDays],
    );
    return rows;
  }

  /**
   * Vista pública de los ítems que respaldan un evento (ADR 0055): una fila por fuente, la publicación más reciente.
   * Ítems viejos sin `link` usan el enlace crudo del adaptador (USGS `url`, GDACS `link`). Solo enlaces https.
   */
  async sourcesView(q: Queryable, itemIds: string[]): Promise<EventSourceView[]> {
    if (itemIds.length === 0) return [];
    const { rows } = await q.query<{
      key: string; name: string; trust_tier: "EXTERNAL" | "OFFICIAL"; license: string | null; terms_url: string | null;
      link: string | null; title: Record<string, string> | null; published_at: Date | null; assertion: "OCCURRING" | "NOT_OCCURRING";
    }>(
      `SELECT DISTINCT ON (s.id) s.key, s.name, s.trust_tier, s.license, s.terms_url,
              coalesce(i.normalized->>'link', i.normalized->'raw'->>'url', i.normalized->'raw'->>'link') AS link,
              i.normalized->'title' AS title, i.published_at, i.assertion
         FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id
        WHERE i.id = ANY($1) AND s.status IN ('ACTIVE','PAUSED')
        ORDER BY s.id, i.published_at DESC NULLS LAST`,
      [itemIds],
    );
    return rows
      .map((r): EventSourceView => ({
        sourceKey: r.key, sourceName: r.name, trustTier: r.trust_tier, license: r.license, termsUrl: safeLink(r.terms_url),
        link: safeLink(r.link), title: r.title && typeof r.title === "object" ? r.title : null,
        publishedAt: r.published_at?.toISOString() ?? null, assertion: r.assertion,
      }))
      .sort((a, b) => (a.trustTier === b.trustTier ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") : a.trustTier === "OFFICIAL" ? -1 : 1));
  }

  // ───────────── Calidad (ADR 0026) ─────────────

  /** Salud de la ingesta: corridas fallidas y demora del carril urgente desde que la fuente publica. */
  async qualityStats(q: Queryable, from: Date, to: Date) {
    const r = await q.query<{ runs: number; failed: number }>(
      `SELECT count(*)::int AS runs, count(*) FILTER (WHERE status = 'FAILED')::int AS failed
         FROM ingestion.runs WHERE started_at >= $1 AND started_at < $2 AND status <> 'SKIPPED_CIRCUIT_OPEN'`,
      [from, to],
    );
    const u = await q.query<{ n: number; p95: number | null }>(
      `SELECT count(*)::int AS n,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fetched_at - published_at)))
                FILTER (WHERE published_at IS NOT NULL AND published_at <= fetched_at) AS p95
         FROM ingestion.external_items WHERE lane = 'URGENT' AND fetched_at >= $1 AND fetched_at < $2`,
      [from, to],
    );
    const { runs, failed } = r.rows[0]!;
    const p95 = u.rows[0]!.p95;
    return {
      runs, failedRuns: failed, failureRate: runs > 0 ? Math.round((failed / runs) * 1000) / 1000 : null,
      urgentItems: u.rows[0]!.n, urgentLagP95Seconds: p95 === null ? null : Math.round(Number(p95) * 10) / 10,
    };
  }
}

/** Solo enlaces https bien formados: el texto viene de fuentes externas. */
export function safeLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * ¿El evento cae en el ámbito de la fuente oficial? (D-PTWC, ADR 0060). La categoría debe estar en su lista (o ser
 * hija de una raíz listada) y el país en su `countryScope` ("*" = global). Un evento sin país solo lo cubre una global.
 */
export function inOfficialScope(source: { categories: readonly string[]; country_scope: readonly string[] }, categoryCode: string, countryCode: string | null): boolean {
  const category = source.categories.some((c) => c === categoryCode || categoryCode.startsWith(`${c}.`));
  const country = source.country_scope.includes("*") || (countryCode !== null && source.country_scope.includes(countryCode));
  return category && country;
}
