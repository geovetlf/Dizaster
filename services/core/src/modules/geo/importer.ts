import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTransaction, type Db } from "../../platform/db.js";
import { applyWordFixes, searchKey, titleCaseEs } from "./names.js";

/** Cómo leer las propiedades de una fuente abierta. Todo es dato: añadir un país no requiere código. */
export interface LayerSpec {
  level?: 1 | 2 | 3;
  idPrefix: string;
  idProp: string;
  /** País fijo (fuentes nacionales) o propiedad con el ISO2 (fuentes globales). */
  country?: string;
  countryProp?: string;
  codeProp?: string;
  /** Primera propiedad no vacía = nombre. */
  nameProps: string[];
  names?: Record<string, string>;
  nameCase?: "title-es";
  /** El padre es el prefijo de `length` caracteres de `prop` ("150122" → "1501"). */
  parent?: { prop: string; length: number };
  populationProp?: string;
}

export interface DatasetSpec {
  id: string;
  kind: "admin" | "places";
  source: string;
  url: string;
  sha256: string;
  license: string;
  attribution: string;
  priority: number;
  layer: LayerSpec;
}

export interface GeoManifest {
  version: string;
  datasets: DatasetSpec[];
  wordFixes?: Record<string, Record<string, string>>;
}

export function loadManifest(dataDir: string): GeoManifest {
  return JSON.parse(readFileSync(join(dataDir, "geo/datasets.json"), "utf8")) as GeoManifest;
}

interface Feature {
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown } | null;
}

/**
 * Algunas fuentes parten un área en varias features con el mismo código (y a veces con erratas en el nombre:
 * "PIURA"/"PUIRA"). Se unen en una MultiPolygon y se conservan las propiedades de la pieza más grande.
 */
/** Área planar aproximada del anillo exterior (fórmula del polígono); solo para comparar piezas entre sí. */
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0]! + ring[i]![0]!) * (ring[j]![1]! - ring[i]![1]!);
  return Math.abs(a / 2);
}

export function mergeSplitFeatures(features: Feature[], idProp: string): Feature[] {
  const byId = new Map<string, Feature[]>();
  const out: Feature[] = [];
  for (const f of features) {
    const id = f.properties?.[idProp];
    if (id === undefined || id === null || !f.geometry || !/Polygon$/.test(f.geometry.type)) {
      out.push(f);
      continue;
    }
    const k = String(id);
    if (!byId.has(k)) {
      byId.set(k, []);
      out.push(f); // el marcador conserva el orden; se reemplaza abajo si hay varias piezas
    }
    byId.get(k)!.push(f);
  }
  return out.map((f) => {
    const id = f.properties?.[idProp];
    const parts = id === undefined || id === null ? undefined : byId.get(String(id));
    if (!parts || parts.length < 2) return f;
    const polys = (g: NonNullable<Feature["geometry"]>) => (g.type === "Polygon" ? [g.coordinates] : (g.coordinates as unknown[]));
    const size = (x: Feature) => polys(x.geometry!).reduce((sum: number, poly) => sum + ringArea((poly as number[][][])[0] ?? []), 0);
    const main = parts.reduce((a, b) => (size(b) > size(a) ? b : a));
    return { properties: main.properties, geometry: { type: "MultiPolygon", coordinates: parts.flatMap((p) => polys(p.geometry!)) } };
  });
}

export interface ImportResult {
  dataset: string;
  inserted: number;
  skipped: number;
}

const str = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const BATCH = 100;

/**
 * Importa un GeoJSON abierto en una transacción: reemplaza lo que había de ese dataset, repara geometrías
 * (ST_MakeValid) y vacía la memoria de contextos para no servir resultados de datos antiguos.
 */
export async function importDataset(db: Db, manifest: GeoManifest, spec: DatasetSpec, bytes: Buffer, opts: { verifyHash?: boolean } = {}): Promise<ImportResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (opts.verifyHash !== false && sha256 !== spec.sha256) {
    throw new Error(`sha256 distinto para ${spec.id}: esperado ${spec.sha256}, recibido ${sha256}. Revisa la fuente y actualiza el manifiesto a propósito.`);
  }
  const fc = { features: mergeSplitFeatures((JSON.parse(bytes.toString("utf8")) as { features: Feature[] }).features, spec.layer.idProp) };
  const L = spec.layer;
  const rows: unknown[][] = [];
  let skipped = 0;
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const country = L.country ?? str(p[L.countryProp ?? ""]);
    const rawId = str(p[L.idProp]);
    const rawName = L.nameProps.map((k) => str(p[k])).find((v) => v !== null) ?? null;
    if (!f.geometry || !rawId || !rawName || !country || !/^[A-Z]{2}$/.test(country)) {
      skipped++;
      continue;
    }
    const cased = L.nameCase === "title-es" ? titleCaseEs(rawName) : rawName;
    const name = applyWordFixes(cased, manifest.wordFixes?.[country]);
    if (spec.kind === "places") {
      rows.push([L.idPrefix + rawId, spec.id, country, name, Math.max(0, Math.round(Number(p[L.populationProp ?? ""] ?? 0)) || 0), JSON.stringify(f.geometry)]);
    } else {
      const names = Object.fromEntries(Object.entries(L.names ?? {}).flatMap(([lang, k]) => (str(p[k]) ? [[lang, str(p[k])]] : [])));
      const parentRaw = L.parent ? str(p[L.parent.prop]) : null;
      const parentId = L.parent && parentRaw && parentRaw.length >= L.parent.length ? L.idPrefix + parentRaw.slice(0, L.parent.length) : null;
      rows.push([L.idPrefix + rawId, spec.id, country, L.level ?? 1, L.codeProp ? str(p[L.codeProp]) : null, name, JSON.stringify(names), searchKey(name), parentId, spec.priority, JSON.stringify(f.geometry)]);
    }
  }

  return withTransaction(db, async (tx) => {
    await tx.query(`DELETE FROM geo.admin_areas WHERE dataset_id = $1`, [spec.id]);
    await tx.query(`DELETE FROM geo.places WHERE dataset_id = $1`, [spec.id]);
    await tx.query(
      `INSERT INTO geo.datasets (id, source, license, attribution, sha256, feature_count, imported_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, license = EXCLUDED.license, attribution = EXCLUDED.attribution,
         sha256 = EXCLUDED.sha256, feature_count = EXCLUDED.feature_count, imported_at = now()`,
      [spec.id, spec.source, spec.license, spec.attribution, sha256, rows.length],
    );
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const width = chunk[0]!.length;
      const values = chunk
        .map((_, r) => {
          const ph = Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`);
          const g = ph[width - 1];
          return spec.kind === "places"
            ? `(${ph.slice(0, -1).join(", ")}, ST_SetSRID(ST_GeomFromGeoJSON(${g}), 4326))`
            : `(${ph.slice(0, -1).join(", ")}, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${g}), 4326)), 3)))`;
        })
        .join(", ");
      const sql =
        spec.kind === "places"
          ? `INSERT INTO geo.places (id, dataset_id, country, name, population, geom) VALUES ${values} ON CONFLICT (id) DO NOTHING`
          : `INSERT INTO geo.admin_areas (id, dataset_id, country, level, code, name, names, search_key, parent_id, priority, geom) VALUES ${values} ON CONFLICT (id) DO NOTHING`;
      inserted += (await tx.query(sql, chunk.flat())).rowCount ?? 0;
    }
    if (spec.kind === "admin") await tx.query(`DELETE FROM geo.admin_areas WHERE dataset_id = $1 AND ST_IsEmpty(geom)`, [spec.id]);
    await tx.query(`TRUNCATE geo.context_cache`);
    return { dataset: spec.id, inserted, skipped: skipped + (rows.length - inserted) };
  });
}
