import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AreaGeometry, AreaSearchQuery, type AreaSearchResult, type ContextualLocation, type GeoPoint, type Sensitivity } from "@dizaster/contracts";
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

/** Esquema de geocódigo (data/geo/geocode-schemes.json): lo específico de cada país es dato. */
interface GeocodeScheme {
  key: string;
  names: string[];
  match: "id" | "code";
  idPrefix?: string;
  pattern: string;
}

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
    this.dataDir = dataDir;
    const fc = JSON.parse(readFileSync(join(dataDir, "countries/countries-50m.geojson"), "utf8")) as { features: CountryFeature[] };
    this.locator = new CountryLocator(fc.features);
    this.countryCodes = new Set(fc.features.map((f) => f.properties.iso2));
    this.countryFeatures = fc.features;
  }

  private readonly countryFeatures: CountryFeature[];
  private readonly countryPoints = new Map<string, { point: GeoPoint; radiusM: number } | null>();

  /**
   * Punto representativo de un país (ADR 0092): centroide del polígono más grande y, si cae fuera (países
   * cóncavos), el punto interior de una grilla más cercano a él. Radio hasta las esquinas de ese polígono (máx.
   * 1500 km). Para fuentes que solo nombran el país. NO AI REQUIRED.
   */
  countryPoint(iso2: string): { point: GeoPoint; radiusM: number } | null {
    if (this.countryPoints.has(iso2)) return this.countryPoints.get(iso2)!;
    const f = this.countryFeatures.find((x) => x.properties.iso2 === iso2);
    let out: { point: GeoPoint; radiusM: number } | null = null;
    if (f) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const ringArea = (r: number[][]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]!; return a + p[0]! * q[1]! - q[0]! * p[1]!; }, 0)) / 2;
      const outer = polys.map((p) => p[0] as number[][]).sort((a, b) => ringArea(b) - ringArea(a))[0]!;
      const xs = outer.map((p) => p[0]!);
      const ys = outer.map((p) => p[1]!);
      const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      let c = { lng: xs.reduce((a, b) => a + b, 0) / xs.length, lat: ys.reduce((a, b) => a + b, 0) / ys.length };
      if (this.locator.locate(c) !== iso2) {
        let best: GeoPoint | null = null;
        for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
          const p = { lng: w + ((e - w) * i) / 20, lat: s + ((n - s) * j) / 20 };
          if (this.locator.locate(p) === iso2 && (!best || distanceMeters(p, c) < distanceMeters(best, c))) best = p;
        }
        if (best) c = best;
      }
      const point = { lat: Math.round(c.lat * 1e4) / 1e4, lng: Math.round(c.lng * 1e4) / 1e4 };
      const corners = [[s, w], [s, e], [n, w], [n, e]] as const;
      out = { point, radiusM: Math.min(1_500_000, Math.round(Math.max(...corners.map(([lat, lng]) => distanceMeters(point, { lat, lng }))))) };
    }
    this.countryPoints.set(iso2, out);
    return out;
  }

  private geocodeSchemes: GeocodeScheme[] | null = null;
  private readonly dataDir: string = "";

  /**
   * Ubica un ítem de fuente que solo trae geocódigos oficiales (ADR 0077, Blueprint §9.4): coincidencia EXACTA con
   * el índice administrativo local, nunca por nombre. Devuelve un punto dentro del área (o de la unión de áreas) y
   * un radio que la cubre entera; null si ningún código se reconoce (el ítem queda sin mapa). NO AI REQUIRED.
   */
  async locateGeocodes(
    q: Queryable, geocodes: readonly { scheme: string; value: string }[],
  ): Promise<{ point: GeoPoint; radiusM: number; areaIds: string[]; area: AreaGeometry | null } | null> {
    // País entero (ISO 3166-1, p. ej. brotes de la OMS): punto representativo y radio amplio, sin área (ADR 0092).
    const countries = geocodes.filter((g) => /^ISO\s?3166-?1$/i.test(g.scheme.trim())).map((g) => g.value.trim().toUpperCase()).filter((c) => this.isCountry(c));
    if (countries.length && countries.length === geocodes.length) {
      const cp = this.countryPoint(countries[0]!);
      return cp ? { ...cp, areaIds: [], area: null } : null;
    }
    const schemes = this.loadGeocodeSchemes();
    const ids: string[] = [];
    const codes: string[] = [];
    for (const g of geocodes.slice(0, 50)) {
      const name = g.scheme.trim().toUpperCase();
      const scheme = schemes.find((s) => s.names.some((n) => n.toUpperCase() === name));
      const value = g.value.trim().toUpperCase();
      if (!scheme || !new RegExp(scheme.pattern).test(value)) continue;
      if (scheme.match === "id") ids.push(`${scheme.idPrefix ?? ""}${value}`);
      else codes.push(value);
    }
    if (ids.length === 0 && codes.length === 0) return null;
    const { rows } = await q.query<{ ids: string[] | null; lat: number | null; lng: number | null; xmin: number; ymin: number; xmax: number; ymax: number }>(
      `WITH a AS (SELECT id, geom FROM geo.admin_areas WHERE id = ANY($1) OR code = ANY($2)),
            u AS (SELECT array_agg(id ORDER BY id) AS ids, ST_Union(geom) AS g FROM a)
       SELECT ids, ST_Y(ST_PointOnSurface(g)) AS lat, ST_X(ST_PointOnSurface(g)) AS lng,
              ST_XMin(g) AS xmin, ST_YMin(g) AS ymin, ST_XMax(g) AS xmax, ST_YMax(g) AS ymax,
              ${AREA_GEOJSON_SQL("g")} AS area, ST_AsGeoJSON(ST_Multi(ST_ConvexHull(g)), 5)::json AS hull
         FROM u WHERE g IS NOT NULL`,
      [ids, codes],
    );
    const r = rows[0] as (typeof rows)[number] & { area: unknown; hull: unknown } | undefined;
    if (!r || r.lat === null || r.lng === null || !r.ids) return null;
    const point = { lat: Math.round(r.lat * 1e5) / 1e5, lng: Math.round(r.lng * 1e5) / 1e5 };
    const corners = [[r.ymin, r.xmin], [r.ymin, r.xmax], [r.ymax, r.xmin], [r.ymax, r.xmax]] as const;
    const radiusM = Math.round(Math.max(...corners.map(([lat, lng]) => distanceMeters(point, { lat, lng }))));
    // El área oficial (ADR 0087) se guarda simplificada; si aun así es demasiado grande, su envolvente convexa.
    const area = AreaGeometry.safeParse(r.area).data ?? AreaGeometry.safeParse(r.hull).data ?? null;
    return { point, radiusM, areaIds: r.ids, area };
  }

  /**
   * Áreas administrativas (niveles 1–3) que cubren una parte real del área afectada (ADR 0087): más del 1 % de la
   * propia área o 1 km². Un vecino que solo toca el borde no cuenta. Acotado a 500.
   */
  async areasIntersecting(q: Queryable, area: AreaGeometry): Promise<string[]> {
    const { rows } = await q.query<{ id: string }>(
      `WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g)
       SELECT a.id FROM geo.admin_areas a, g
        WHERE ST_Intersects(a.geom, g.g)
          AND ST_Area(ST_Intersection(a.geom, g.g)::geography) > least(1e6, 0.01 * ST_Area(a.geom::geography))
        LIMIT 500`,
      [JSON.stringify(area)],
    );
    return rows.map((r) => r.id);
  }

  private loadGeocodeSchemes(): GeocodeScheme[] {
    this.geocodeSchemes ??= (JSON.parse(readFileSync(join(this.dataDir, "geo/geocode-schemes.json"), "utf8")) as { schemes: GeocodeScheme[] }).schemes;
    return this.geocodeSchemes;
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

  private readonly searchNames = new Map<string, string[]>();
  /** Nombres del país en es y en, normalizados (en caché: se calculan una vez por país). */
  private countrySearchNames(code: string): string[] {
    let names = this.searchNames.get(code);
    if (!names) {
      names = [];
      for (const lang of ["es", "en"]) {
        try { names.push(searchKey(new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? "")); } catch { /* código sin nombre */ }
      }
      this.searchNames.set(code, names);
    }
    return names;
  }

  countryName(code: string): string {
    return this.countryNames.of(code) ?? code;
  }

  /** Búsqueda de lugares por nombre (sin tildes, por prefijo de palabra) para centrar el mapa. Sin geocodificador externo. */
  /**
   * Para buscar eventos por lugar (ADR 0065): ids de las áreas cuyo nombre coincide con la palabra, con todas sus
   * subdivisiones (buscar "Lima" encuentra eventos de sus distritos), y países cuyo nombre en es/en coincide.
   */
  async placeMatches(q: Queryable, word: string): Promise<{ areaIds: string[]; countries: string[] }> {
    const key = searchKey(word);
    if (key.length < 2) return { areaIds: [], countries: [] };
    const like = key.replace(/[\\%_]/g, "\\$&");
    const { rows } = await q.query<{ id: string }>(
      `WITH RECURSIVE hit AS (
         SELECT id FROM geo.admin_areas WHERE search_key LIKE $1 || '%' OR search_key LIKE '% ' || $1 || '%' LIMIT 20
       ), tree AS (
         SELECT id FROM hit UNION SELECT a.id FROM geo.admin_areas a JOIN tree t ON a.parent_id = t.id
       )
       SELECT id FROM tree LIMIT 5000`,
      [like],
    );
    const countries = [...this.countryCodes].filter((c) =>
      /^[A-Z]{2}$/.test(c) && this.countrySearchNames(c).some((k) => k.startsWith(key) || k.includes(` ${key}`)),
    );
    return { areaIds: rows.map((r) => r.id), countries };
  }

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

/** GeoJSON simplificado (~100 m) y válido de una geometría, para guardarla como área afectada. */
export const AREA_GEOJSON_SQL = (col: string) =>
  `ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(${col}, 0.001)), 3)), 5)::json`;
