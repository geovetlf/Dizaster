#!/usr/bin/env node
// Genera los estilos MapLibre (claro y oscuro) para las teselas propias en PMTiles (esquema Protomaps).
// Uso: TILES_URL=https://<bucket>/maps/pe.pmtiles ASSETS_URL=https://<bucket>/maps/assets \
//      node infra/maps/make-style.mjs [salida=infra/maps/out] [idioma=es]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";

const tiles = process.env.TILES_URL;
const assets = process.env.ASSETS_URL;
if (!tiles || !assets) {
  console.error("Faltan TILES_URL y ASSETS_URL (URLs públicas del bucket).");
  process.exit(2);
}
const out = process.argv[2] ?? "infra/maps/out";
const lang = process.argv[3] ?? "es";
mkdirSync(out, { recursive: true });

for (const [scheme, flavor] of [["light", "light"], ["dark", "dark"]]) {
  const style = {
    version: 8,
    name: `dizaster-${scheme}`,
    // Atribución obligatoria por la licencia ODbL de OpenStreetMap.
    sources: { protomaps: { type: "vector", url: `pmtiles://${tiles}`, attribution: "© OpenStreetMap" } },
    glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}/sprites/v4/${flavor}`,
    layers: layers("protomaps", namedFlavor(flavor), { lang }),
  };
  const file = join(out, `style-${scheme}.json`);
  writeFileSync(file, JSON.stringify(style));
  console.log(`${file}: ${style.layers.length} capas`);
}
