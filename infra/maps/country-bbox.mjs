#!/usr/bin/env node
// Caja envolvente de un país (ISO2) a partir de los polígonos Natural Earth que ya usa la app.
// Uso: node infra/maps/country-bbox.mjs PE   →   -81.41,-18.35,-68.67,-0.04
import { readFileSync } from "node:fs";

const iso2 = (process.argv[2] ?? "").toUpperCase();
if (!/^[A-Z]{2}$/.test(iso2)) {
  console.error("Uso: country-bbox.mjs <ISO2>");
  process.exit(2);
}
const fc = JSON.parse(readFileSync(new URL("../../data/countries/countries-50m.geojson", import.meta.url), "utf8"));
const f = fc.features.find((x) => x.properties.iso2 === iso2);
if (!f) {
  console.error(`País ${iso2} no encontrado`);
  process.exit(1);
}
const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
let [w, s, e, n] = [180, 90, -180, -90];
for (const p of polys) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
console.log([w, s, e, n].map((v) => v.toFixed(2)).join(","));
