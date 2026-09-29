import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoPoint, Sensitivity } from "@dizaster/contracts";
import { CountryLocator, H3_RES, distanceMeters, generalize, h3, type CountryFeature } from "@dizaster/geo-kit";

/**
 * Geo Engine (servidor): calcula; no dibuja mapas y no llama a ninguna API externa.
 * País por polígonos abiertos locales (Natural Earth). Zonas horarias por país en esta etapa;
 * los países con varias zonas horarias usarán polígonos de timezone-boundary-builder (siguiente etapa).
 */
export class GeoService {
  private readonly locator: CountryLocator;

  constructor(dataDir: string) {
    const fc = JSON.parse(readFileSync(join(dataDir, "countries/countries-50m.geojson"), "utf8")) as { features: CountryFeature[] };
    this.locator = new CountryLocator(fc.features);
  }

  countryOf(point: GeoPoint): string | null {
    return this.locator.locate(point);
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
}
