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
