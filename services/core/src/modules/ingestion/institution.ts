import { OfficialScopeRequest, OfficialStatementRequest, type OfficialScopeView } from "@dizaster/contracts";
import type { z } from "zod";
import type { Clock } from "../../platform/clock.js";
import type { Db, Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import type { EventService } from "../event/index.js";
import type { GeoService } from "../geo/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { BusinessService } from "../social/index.js";
import { inOfficialScope, type IngestionService } from "./index.js";

/** Adapter de las fuentes institucionales: no se descarga nada, las declaraciones llegan desde la app. */
export const INSTITUTION_ADAPTER = "institutional-profile";
export const institutionSourceKey = (businessId: string) => `institution:${businessId}`;

/**
 * Perfiles institucionales oficiales como fuente OFICIAL (ADR 0095, §10.2, D-04).
 *
 * Cada perfil con el sello INSTITUTIONAL_OFFICIAL y un ámbito fijado por administración es una fuente registrada
 * más (`institution:<id>`, trust OFFICIAL). Su confirmación o desmentido explícito de un EVENT entra por el mismo
 * camino que un ítem de una fuente oficial, así que el motor de verificación le aplica las mismas reglas: ámbito,
 * monotonía, prioridad del desmentido y explicación. Nunca es un reporte ciudadano.
 * NO AI REQUIRED.
 */
export class InstitutionService {
  constructor(
    private readonly db: Db,
    private readonly ingestion: IngestionService,
    private readonly events: EventService,
    private readonly business: BusinessService,
    private readonly ref: ReferenceData,
    private readonly geo: GeoService,
    private readonly clock: Clock,
  ) {}

  /** Solo administración. Exige el sello institucional. Categorías del catálogo y países del índice. */
  async setScope(handle: string, raw: unknown): Promise<OfficialScopeView> {
    const scope = parseBody(OfficialScopeRequest, raw);
    const b = await this.business.officialInfo(this.db, handle);
    if (!b) throw notFound("Negocio");
    if (b.verification !== "INSTITUTIONAL_OFFICIAL") {
      throw new DomainError("NOT_INSTITUTIONAL", "Primero hay que darle el sello de institución oficial", 409);
    }
    const unknownCategory = scope.categories.find((c) => !this.ref.category(c));
    if (unknownCategory) throw new DomainError("VALIDATION", `Categoría desconocida: ${unknownCategory}`, 400);
    const unknownCountry = scope.countries.find((c) => !this.geo.isCountry(c));
    if (unknownCountry) throw new DomainError("VALIDATION", `País desconocido: ${unknownCountry}`, 400);
    const categories = [...new Set(scope.categories)].sort();
    const countries = [...new Set(scope.countries)].sort();
    await this.db.query(
      `INSERT INTO ingestion.sources (id, key, name, type, trust_tier, country_scope, categories, adapter, config, status)
       VALUES ($1, $2, $3, 'OFFICIAL', 'OFFICIAL', $4, $5, $6, '{}', 'ACTIVE')
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, country_scope = EXCLUDED.country_scope, categories = EXCLUDED.categories,
         status = 'ACTIVE', updated_at = now()`,
      [newId(), institutionSourceKey(b.id), b.name, countries, categories, INSTITUTION_ADAPTER],
    );
    return { categories, countries, active: true };
  }

  async scope(q: Queryable, businessId: string): Promise<OfficialScopeView | null> {
    const { rows } = await q.query<{ categories: string[]; country_scope: string[]; status: string }>(
      `SELECT categories, country_scope, status FROM ingestion.sources WHERE key = $1`, [institutionSourceKey(businessId)],
    );
    const r = rows[0];
    return r ? { categories: r.categories, countries: r.country_scope, active: r.status === "ACTIVE" } : null;
  }

  /** Pierde el sello o se borra: sus declaraciones dejan de contar como oficiales (el nivel ya alcanzado no baja). */
  async retire(q: Queryable, businessIds: string[]): Promise<void> {
    if (businessIds.length === 0) return;
    await q.query(
      `UPDATE ingestion.sources SET status = 'RETIRED', updated_at = now() WHERE key = ANY($1) AND status <> 'RETIRED'`,
      [businessIds.map(institutionSourceKey)],
    );
  }

  /** Quien administra el perfil, con el sello vigente, visible y con ámbito activo. */
  private async authorized(userId: string, handle: string): Promise<{ id: string; scope: OfficialScopeView }> {
    const b = await this.business.officialInfo(this.db, handle);
    if (!b || b.ownerUserId !== userId) throw notFound("Negocio");
    const scope = await this.scope(this.db, b.id);
    if (b.verification !== "INSTITUTIONAL_OFFICIAL" || !b.visible || !scope?.active) {
      throw new DomainError("NOT_INSTITUTIONAL", "Este perfil no puede pronunciarse oficialmente", 403);
    }
    return { id: b.id, scope };
  }

  private assertInScope(scope: OfficialScopeView, event: { categoryCode: string; countryCode: string | null }): void {
    if (!inOfficialScope({ categories: scope.categories, country_scope: scope.countries }, event.categoryCode, event.countryCode)) {
      throw new DomainError("OUT_OF_SCOPE", "El evento está fuera del ámbito de esta institución", 403);
    }
  }

  /** Publicar una actualización oficial (ADR 0153): mismas condiciones que una declaración. */
  async assertCanPostUpdate(userId: string, handle: string, event: { categoryCode: string; countryCode: string | null }): Promise<void> {
    this.assertInScope((await this.authorized(userId, handle)).scope, event);
  }

  /**
   * Confirmar o desmentir un EVENT como la institución. Solo quien administra el perfil, con el sello vigente,
   * dentro de su ámbito y sobre un evento activo. Una institución se pronuncia una sola vez por evento: repetir lo
   * mismo es idempotente y decir lo contrario da 409 (corregir es cosa de moderación, con auditoría).
   */
  async statement(userId: string, handle: string, raw: unknown): Promise<{ eventId: string; assertion: "OCCURRING" | "NOT_OCCURRING" }> {
    const req = parseBody(OfficialStatementRequest, raw);
    const b = await this.authorized(userId, handle);
    let event = await this.events.getEvent(this.db, req.eventId);
    for (let hops = 0; event.mergedIntoId && hops < 5; hops++) event = await this.events.getEvent(this.db, event.mergedIntoId);
    this.assertInScope(b.scope, event);
    const key = institutionSourceKey(b.id);
    const { rows: previous } = await this.db.query<{ assertion: string }>(
      `SELECT i.assertion FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id
        WHERE s.key = $1 AND i.event_id = $2`,
      [key, event.id],
    );
    if (previous.some((p) => p.assertion === req.assertion)) return { eventId: event.id, assertion: req.assertion };
    if (previous.length > 0) throw new DomainError("ALREADY_STATED", "Esta institución ya se pronunció sobre este evento", 409);

    const now = this.clock.now().toISOString();
    await this.ingestion.ingest(key, {
      externalId: `${event.id}:${req.assertion}`,
      categoryCode: event.categoryCode,
      point: event.point,
      uncertaintyM: 0,
      occurredAt: now,
      publishedAt: now,
      title: null,
      severity: null,
      assertion: req.assertion,
      targetEventId: event.id,
      raw: { businessId: b.id, userId, eventId: event.id, assertion: req.assertion },
    }, "URGENT");
    return { eventId: event.id, assertion: req.assertion };
  }
}

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}
