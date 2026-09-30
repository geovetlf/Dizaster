#!/usr/bin/env node
// Genera los estilos MapLibre (claro y oscuro) para las teselas propias en PMTiles (esquema Protomaps), uno por
// idioma de la app (ADR 0193): style-<esquema>-<idioma>.json. Las teselas son las mismas; solo cambian las etiquetas.
// Además escribe style-<esquema>.json en el primer idioma (compatibilidad con URLs sin {lang}).
// Uso: TILES_URL=https://<bucket>/maps/pe.pmtiles ASSETS_URL=https://<bucket>/maps/assets \
//      node infra/maps/make-style.mjs [salida=infra/maps/out] [idiomas=es,en,pt,fr]
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
const langs = (process.argv[3] ?? "es,en,pt,fr").split(",").map((l) => l.trim()).filter(Boolean);
mkdirSync(out, { recursive: true });

for (const [scheme, flavor] of [["light", "light"], ["dark", "dark"]]) for (const [i, lang] of langs.entries()) {
  const style = {
    version: 8,
    name: `dizaster-${scheme}`,
    // Atribución obligatoria por la licencia ODbL de OpenStreetMap.
    sources: { protomaps: { type: "vector", url: `pmtiles://${tiles}`, attribution: "© OpenStreetMap" } },
    glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}/sprites/v4/${flavor}`,
    layers: layers("protomaps", namedFlavor(flavor), { lang }),
  };
  const file = join(out, `style-${scheme}-${lang}.json`);
  writeFileSync(file, JSON.stringify(style));
  if (i === 0) writeFileSync(join(out, `style-${scheme}.json`), JSON.stringify(style));
  console.log(`${file}: ${style.layers.length} capas`);
}
