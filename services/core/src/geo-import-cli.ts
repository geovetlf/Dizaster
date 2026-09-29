import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { importDataset, loadManifest } from "./modules/geo/index.js";
import { createPool } from "./platform/db.js";
import { defaultDataDir } from "./platform/paths.js";

/**
 * Importa el índice geográfico abierto (data/geo/datasets.json) en PostGIS.
 *   DATABASE_URL=… node dist/geo-import-cli.js [id …]          (sin ids: todos)
 * Descarga cada fuente una vez a GEO_CACHE_DIR (por defecto .data/geo-cache) y verifica su sha256.
 * Detrás de un proxy: NODE_USE_ENV_PROXY=1.
 */
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL es obligatorio");
const dataDir = process.env["DATA_DIR"] ?? defaultDataDir();
const cacheDir = resolve(process.env["GEO_CACHE_DIR"] ?? ".data/geo-cache");
const manifest = loadManifest(dataDir);
const wanted = process.argv.slice(2);
const specs = wanted.length ? manifest.datasets.filter((d) => wanted.includes(d.id)) : manifest.datasets;
const unknown = wanted.filter((w) => !manifest.datasets.some((d) => d.id === w));
if (unknown.length) throw new Error(`Datasets desconocidos: ${unknown.join(", ")}`);

mkdirSync(cacheDir, { recursive: true });
const db = createPool(url);
try {
  for (const spec of specs) {
    const file = join(cacheDir, `${spec.id}.geojson`);
    if (!existsSync(file)) {
      console.log(`Descargando ${spec.id} de ${spec.url}`);
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${spec.id}: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const r = await importDataset(db, manifest, spec, readFileSync(file));
    console.log(`${r.dataset}: ${r.inserted} importados, ${r.skipped} omitidos (${spec.license})`);
  }
} finally {
  await db.end();
}
