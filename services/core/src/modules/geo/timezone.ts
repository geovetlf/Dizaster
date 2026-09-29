import { find, setCache } from "geo-tz";
import type { GeoPoint } from "@dizaster/contracts";

/** Zona horaria IANA de un punto (Blueprint §5.5). Detrás de una interfaz: los datos se pueden cambiar sin tocar el resto. */
export interface TimezoneLocator {
  at(point: GeoPoint): string | null;
}

/** Trozos de polígonos decodificados que se mantienen en memoria (cada uno es una celda del índice de geo-tz). */
const MAX_CACHED_CHUNKS = 64;

/** Map acotado: al llenarse descarta lo más antiguo. Evita que el proceso cargue todos los polígonos del mundo. */
class BoundedCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    return this.map.get(key);
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

/**
 * Polígonos de timezone-boundary-builder (datos abiertos derivados de OSM, ODbL) empaquetados por geo-tz, en el
 * conjunto "1970" (26 MB): el "now" fusiona zonas que hoy tienen la misma hora y Manaus saldría como Caracas.
 * Se leen del disco bajo demanda: sin API externa ni base de datos. En el mar devuelve la zona náutica (Etc/GMT±N).
 */
export function polygonTimezones(maxChunks = MAX_CACHED_CHUNKS): TimezoneLocator {
  setCache({ store: new BoundedCache(maxChunks) });
  return {
    at(point) {
      return find(point.lat, point.lng)[0] ?? null;
    },
  };
}

/**
 * Regla de resolución: si el país tiene una sola zona, esa (sin leer polígonos); si tiene varias o no se conoce el
 * país, los polígonos. Una zona de polígono que no está en la lista del país se acepta igual (frontera, datos nuevos).
 */
export function resolveTimezone(point: GeoPoint, countryZones: readonly string[] | undefined, polygons: TimezoneLocator): string | null {
  if (countryZones?.length === 1) return countryZones[0]!;
  return polygons.at(point);
}

/** Atribución de los polígonos de zona horaria (se muestra en "Acerca de"). */
export const TIMEZONE_ATTRIBUTION = {
  id: "timezone-boundary-builder",
  name: "timezone-boundary-builder",
  attribution: "© OpenStreetMap contributors; timezone-boundary-builder (Evan Siroky)",
  license: "ODbL 1.0",
  url: "https://github.com/evansiroky/timezone-boundary-builder",
} as const;
