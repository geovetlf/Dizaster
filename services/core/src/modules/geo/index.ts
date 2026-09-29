import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AreaSearchQuery, type AreaSearchResult, type ContextualLocation, type GeoPoint, type Sensitivity } from "@dizaster/contracts";
import { CountryLocator, H3_RES, distanceMeters, generalize, h3, type CountryFeature } from "@dizaster/geo-kit";
import type { Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import type { Meter } from "../../platform/metrics.js";
import type { ReferenceData } from "../reference/index.js";
import { labelFor, toContextualLocation, type ResolvedContext } from "./context.js";
import { searchKey } from "./names.js";
import { polygonTimezones, resolveTimezone, type TimezoneLocator } from "./timezone.js";

export { importDataset, loadManifest, type DatasetSpec, type GeoManifest, type ImportResult } from "./importer.js";
export { MAX_GRANULARITY, labelFor, toContextualLocation, type ResolvedContext } from "./context.js";
export { searchKey, titleCaseEs } from "./names.js";
export { TIMEZONE_ATTRIBUTION, polygonTimezones, resolveTimezone, type TimezoneLocator } from "./timezone.js";

/** Tolerancia para puntos que caen justo fuera de un polígono simplificado (costa, bordes): ~2 km. */
const EDGE_TOLERANCE_DEG = 0.02;
/** Radio máximo para nombrar una ciudad por cercanía donde no hay polígonos de ciudad. */
const CITY_RADIUS_M = 30_000;
/** Resolución H3 de la memoria de contextos (~0,1 km²). */
const CACHE_RES = H3_RES.DEDUP;
const DEFAULT_LEVEL_NAMES = { "1": "Región", "2": "Provincia", "3": "Distrito" } as const;

/**
 * Geo Engine (servidor): calcula; no dibuja mapas y no llama a ninguna API externa.
 * - País: polígonos Natural Earth en memoria (no necesita base de datos).
 * - Región/ciudad/distrito: índice administrativo abierto en PostGIS (esquema geo), importado desde data/geo.
 * Tres ubicaciones separadas: la privada de presencia (report), la pública del EVENT (generalizada) y la
 * contextual (este índice), que se calcula siempre desde la pública.
 */
export class GeoService {
  private readonly locator: CountryLocator;
  private readonly countryNames = new Intl.DisplayNames(["es"], { type: "region" });
  private readonly countryCodes: Set<string>;

  constructor(
    dataDir: string,
    private readonly ref: ReferenceData,
    private readonly meter?: Meter,
    private readonly timezones: TimezoneLocator = polygonTimezones(),
  ) {
    const fc = JSON.parse(readFileSync(join(dataDir, "countries/countries-50m.geojson"), "utf8")) as { features: CountryFeature[] };
    this.locator = new CountryLocator(fc.features);
    this.countryCodes = new Set(fc.features.map((f) => f.properties.iso2));
  }

  countryOf(point: GeoPoint, maxDistanceM?: number): string | null {
    return this.locator.locate(point, maxDistanceM);
  }

  distanceMeters(a: GeoPoint, b: GeoPoint): number {
    return distanceMeters(a, b);
  }

  h3(point: GeoPoint, res: number): string {
    return h3(point, res);
  }

  generalize(point: GeoPoint, sensitivity: Sensitivity) {
    return generalize(point, sensitivity);
  }

  readonly RES = H3_RES;

  /**
   * Ubicación contextual publicable para un punto PÚBLICO (ya generalizado). Nunca pasar aquí la
   * ubicación privada del reportero: el nombre de un distrito pequeño también es información.
   */
  async contextFor(q: Queryable, publicPoint: GeoPoint, sensitivity: Sensitivity): Promise<ContextualLocation | null> {
    return toContextualLocation(await this.resolveAdmin(q, publicPoint), sensitivity);
  }

  /** Blueprint §5: resolveAdmin(point) → país, región, ciudad, distrito y zona horaria. Memorizado por celda H3. */
  async resolveAdmin(q: Queryable, point: GeoPoint): Promise<ResolvedContext> {
    const cell = h3(point, CACHE_RES);
    const cached = await q.query<{ context: ResolvedContext }>(`SELECT context FROM geo.context_cache WHERE cell = $1::h3index`, [cell]);
    if (cached.rows[0]) {
      this.meter?.add("geo", "context_lookups", 1, "cache");
      return cached.rows[0].context;
    }
    this.meter?.add("geo", "context_lookups", 1, "index");
    const ctx = await this.lookup(q, point);
    await q.query(`INSERT INTO geo.context_cache (cell, context) VALUES ($1::h3index, $2) ON CONFLICT (cell) DO NOTHING`, [cell, JSON.stringify(ctx)]);
    return ctx;
  }

  private async lookup(q: Queryable, point: GeoPoint): Promise<ResolvedContext> {
    const { rows } = await q.query<{ id: string; country: string; level: number; code: string | null; name: string; priority: number; dist_m: number }>(
      `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g)
       SELECT a.id, a.country, a.level, a.code, a.name, a.priority,
              CASE WHEN ST_Intersects(a.geom, p.g) THEN 0 ELSE ST_Distance(a.geom::geography, p.g::geography) END AS dist_m
         FROM geo.admin_areas a, p
        WHERE ST_DWithin(a.geom, p.g, $3)`,
      [point.lng, point.lat, EDGE_TOLERANCE_DEG],
    );
    // País: el de un área que CONTIENE el punto (la de más prioridad); si no, el polígono de país; si no, el área más cercana.
    const containing = rows.filter((r) => r.dist_m === 0).sort((a, b) => b.priority - a.priority);
    const nearest = [...rows].sort((a, b) => a.dist_m - b.dist_m);
    const countryCode = containing[0]?.country.trim() ?? this.countryOf(point) ?? nearest[0]?.country.trim() ?? null;
    const own = rows.filter((r) => r.country.trim() === countryCode);
    // Tolerancia de borde SOLO cuando el punto cae fuera de los polígonos de la fuente principal (costa, mar cercano). Si está en
    // tierra pero su distrito falta en la fuente, se omite el distrito: un vecino cercano sería un nombre falso.
    const top = Math.max(...own.map((r) => r.priority));
    const onLand = own.some((r) => r.dist_m === 0 && r.priority === top);
    const best = (level: number) =>
      own.filter((r) => r.level === level && (!onLand || r.dist_m === 0)).sort((a, b) => b.priority - a.priority || a.dist_m - b.dist_m)[0] ?? null;
    const asRef = (r: { id: string; code: string | null; name: string } | null) => (r ? { id: r.id, code: r.code, name: r.name } : null);

    const geoCfg = countryCode ? this.ref.country(countryCode)?.geo : undefined;
    const region = asRef(best(1));
    const district = geoCfg?.districtLevel ? asRef(best(geoCfg.districtLevel)) : null;
    let city: ResolvedContext["city"] = null;
    if (geoCfg?.cityLevel) {
      const c = best(geoCfg.cityLevel);
      city = c ? { id: c.id, name: c.name } : null;
    }
    if (!city && countryCode) city = await this.nearestPlace(q, point, countryCode);
    return {
      country: countryCode ? { code: countryCode, name: this.countryName(countryCode) } : null,
      region,
      city,
      district,
      timezone: resolveTimezone(point, countryCode ? this.ref.country(countryCode)?.timezones : undefined, this.timezones),
    };
  }

  private async nearestPlace(q: Queryable, point: GeoPoint, country: string): Promise<{ id: string; name: string } | null> {
    const { rows } = await q.query<{ id: string; name: string }>(
      `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g)
       SELECT pl.id, pl.name FROM geo.places pl, p
        WHERE pl.country = $3 AND ST_DWithin(pl.geom::geography, p.g::geography, $4)
        ORDER BY pl.geom <-> p.g LIMIT 1`,
      [point.lng, point.lat, country, CITY_RADIUS_M],
    );
    return rows[0] ?? null;
  }

  /** País presente en el dataset de fronteras (ISO 3166-1 alfa-2). */
  isCountry(code: string): boolean {
    return this.countryCodes.has(code);
  }

  countryName(code: string): string {
    return this.countryNames.of(code) ?? code;
  }

  /** Búsqueda de lugares por nombre (sin tildes, por prefijo de palabra) para centrar el mapa. Sin geocodificador externo. */
  async searchAreas(q: Queryable, raw: unknown): Promise<AreaSearchResult[]> {
    const parsed = AreaSearchQuery.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { q: text, country, limit, lat, lng } = parsed.data;
    const near = lat !== undefined && lng !== undefined ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : null;
    const key = searchKey(text);
    if (key.length < 2) return [];
    const like = key.replace(/[\\%_]/g, "\\$&");
    const { rows } = await q.query<{
      id: string; country: string; level: 1 | 2 | 3; name: string; parent_name: string | null; grand_name: string | null;
      lat: number; lng: number; w: number; s: number; e: number; n: number;
    }>(
      `SELECT a.id, a.country, a.level, a.name, p.name AS parent_name, gp.name AS grand_name,
              ST_Y(ST_PointOnSurface(a.geom)) AS lat, ST_X(ST_PointOnSurface(a.geom)) AS lng,
              ST_XMin(a.geom) AS w, ST_YMin(a.geom) AS s, ST_XMax(a.geom) AS e, ST_YMax(a.geom) AS n
         FROM geo.admin_areas a
         LEFT JOIN geo.admin_areas p ON p.id = a.parent_id
         LEFT JOIN geo.admin_areas gp ON gp.id = p.parent_id
        WHERE (a.search_key LIKE $1 || '%' OR a.search_key LIKE '% ' || $1 || '%')
          AND ($2::text IS NULL OR a.country = $2)
          -- Si un país tiene fuente oficial para un nivel, no se duplica con la global (p. ej. Natural Earth).
          AND NOT EXISTS (SELECT 1 FROM geo.admin_areas b WHERE b.country = a.country AND b.level = a.level AND b.priority > a.priority)
        ORDER BY (a.search_key = $3) DESC, (a.search_key LIKE $1 || '%') DESC,
                 CASE WHEN $5::float8 IS NULL THEN 0 ELSE a.geom <-> ST_SetSRID(ST_MakePoint($5, $6::float8), 4326) END, a.level, a.name
        LIMIT $4`,
      [like, country ?? null, key, limit, near?.lng ?? null, near?.lat ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      level: r.level,
      kind: this.ref.country(r.country.trim())?.geo?.levelNames?.[String(r.level) as "1" | "2" | "3"] ?? DEFAULT_LEVEL_NAMES[String(r.level) as "1" | "2" | "3"],
      countryCode: r.country.trim(),
      name: r.name,
      label: [r.name, r.parent_name, r.grand_name, this.countryName(r.country.trim())]
        .filter((x, i, all): x is string => !!x && all.findIndex((y) => y?.toLocaleLowerCase("es") === x.toLocaleLowerCase("es")) === i)
        .join(", "),
      center: { lat: r.lat, lng: r.lng },
      bbox: [r.w, r.s, r.e, r.n],
    }));
  }

  /** Áreas por id (para nombrar lugares seguidos y validar que existen). */
  async areasByIds(q: Queryable, ids: string[]): Promise<{ id: string; name: string; label: string }[]> {
    if (ids.length === 0) return [];
    const { rows } = await q.query<{ id: string; name: string; parent_name: string | null; country: string }>(
      `SELECT a.id, a.name, p.name AS parent_name, a.country
         FROM geo.admin_areas a LEFT JOIN geo.admin_areas p ON p.id = a.parent_id
        WHERE a.id = ANY($1)`,
      [ids],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, label: labelFor({ name: this.countryName(r.country.trim()) }, null, r.parent_name ? { name: r.parent_name } : null, { name: r.name }) }));
  }

  /** Datasets geográficos importados (para atribución de licencias en la app). */
  async datasets(q: Queryable): Promise<{ id: string; source: string; license: string; attribution: string; importedAt: string }[]> {
    const { rows } = await q.query<{ id: string; source: string; license: string; attribution: string; imported_at: Date }>(
      `SELECT id, source, license, attribution, imported_at FROM geo.datasets ORDER BY id`,
    );
    return rows.map((r) => ({ id: r.id, source: r.source, license: r.license, attribution: r.attribution, importedAt: r.imported_at.toISOString() }));
  }
}

