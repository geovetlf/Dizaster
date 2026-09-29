import { CountryLocator, type CountryFeature } from "@dizaster/geo-kit";
import type { GeoPoint } from "@dizaster/contracts";

let locator: CountryLocator | null = null;

/** Detección de país 100 % en el dispositivo: sin red y sin enviar la ubicación a ningún servidor. */
export function countryOf(point: GeoPoint): string | null {
  if (!locator) {
    // Carga perezosa: el GeoJSON (~1,6 MB) solo se parsea la primera vez que hace falta.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fc = require("../../reference-data/countries.json") as { features: CountryFeature[] };
    locator = new CountryLocator(fc.features);
  }
  return locator.locate(point);
}

let names: { code: string; name: string }[] | null = null;

/** Países del dataset de fronteras con su nombre en el idioma de la app si el motor lo sabe (si no, en inglés). */
export function countryOptions(lang: string): { code: string; name: string }[] {
  if (!names) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fc = require("../../reference-data/countries.json") as { features: { properties: { iso2: string; name: string } }[] };
    names = fc.features.map((f) => ({ code: f.properties.iso2, name: f.properties.name })).filter((c) => /^[A-Z]{2}$/.test(c.code));
  }
  let display: Intl.DisplayNames | null = null;
  try { display = new Intl.DisplayNames([lang], { type: "region" }); } catch { display = null; }
  return names.map((c) => ({ code: c.code, name: display?.of(c.code) ?? c.name })).sort((a, b) => a.name.localeCompare(b.name, lang));
}
