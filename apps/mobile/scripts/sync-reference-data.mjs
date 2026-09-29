// Copia los datos de referencia versionados (/data) al bundle de la app para que funcionen OFFLINE:
// polígonos de países (detección de país sin red) y números de emergencia.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const out = resolve(here, "..", "src", "reference-data");
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, "data/countries/countries-50m.geojson"), resolve(out, "countries.json"));
copyFileSync(resolve(root, "data/emergency-numbers/emergency-numbers.json"), resolve(out, "emergency-numbers.json"));
copyFileSync(resolve(root, "data/categories/categories.json"), resolve(out, "categories.json"));
console.log("reference data synced");
