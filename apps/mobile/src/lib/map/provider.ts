import type { AppConfig, MapProviderConfig } from "@dizaster/contracts";

/**
 * El Map Engine de la app depende SOLO de esta interfaz. El proveedor real (tiles OSM propios en PMTiles,
 * MapTiler, Stadia...) llega por /v1/config: cambiarlo no requiere publicar una versión nueva.
 */
export interface MapProvider {
  id: string;
  styleUrl(scheme: "light" | "dark"): string;
  attribution: string;
  maxZoom: number;
}

/** Estilo mínimo sin red: si el proveedor falla, el mapa sigue mostrando eventos sobre un fondo liso. */
export const OFFLINE_FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": "#e8eef2" } }],
};

export function providerFromConfig(map: MapProviderConfig): MapProvider {
  return {
    id: map.id,
    styleUrl: (scheme) => (scheme === "dark" ? map.styleUrl.dark : map.styleUrl.light),
    attribution: map.attribution,
    maxZoom: map.maxZoom,
  };
}

export function providerFromAppConfig(config: AppConfig | null): MapProvider | null {
  if (!config || config.map.kind === "NONE") return null;
  return providerFromConfig(config.map);
}
