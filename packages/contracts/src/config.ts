import { z } from "zod";

/**
 * Proveedor cartográfico desacoplado. La app lo lee de /v1/config: cambiar de proveedor
 * es un cambio de configuración, no una nueva versión de la app.
 */
export const MapProviderConfig = z.object({
  id: z.string(),
  kind: z.enum(["SELF_HOSTED_PMTILES", "VECTOR_STYLE_URL", "NONE"]),
  styleUrl: z.object({ light: z.string(), dark: z.string() }),
  attribution: z.string(),
  maxZoom: z.number().int().min(0).max(24),
  offlineRegions: z.boolean(),
});
export type MapProviderConfig = z.infer<typeof MapProviderConfig>;

export const AppConfig = z.object({
  apiVersion: z.literal("v1"),
  map: MapProviderConfig,
  /** Interruptores remotos para funciones costosas. */
  killSwitches: z.record(z.string(), z.boolean()),
  limits: z.object({
    maxVideoSeconds: z.number().int(),
    maxReportsPerHour: z.number().int(),
  }),
  referenceVersions: z.object({ categories: z.string(), emergencyNumbers: z.string() }),
});
export type AppConfig = z.infer<typeof AppConfig>;

/**
 * Atribución de datos de terceros (pantalla "Acerca de", Blueprint §11.3). ODbL exige mostrar "© OpenStreetMap
 * contributors"; cada dataset o fuente lleva su licencia. La lista la arma el servidor: cambia con los datos.
 */
export const AttributionKind = z.enum(["MAP", "GEO", "TIMEZONE", "SOURCE"]);
export type AttributionKind = z.infer<typeof AttributionKind>;

export const Attribution = z.object({
  id: z.string(),
  kind: AttributionKind,
  name: z.string(),
  attribution: z.string(),
  license: z.string(),
  url: z.string().nullable(),
});
export type Attribution = z.infer<typeof Attribution>;

export const AttributionsResponse = z.object({ attributions: z.array(Attribution) });
export type AttributionsResponse = z.infer<typeof AttributionsResponse>;

/** Kill switches de media (ADR 0082): claves en `AppConfig.killSwitches` y en el tablero de costos. */
export const MEDIA_KILL_SWITCHES = { uploads: "media-upload", video: "video" } as const;

/** Qué se puede adjuntar según los kill switches remotos. Un switch ausente cuenta como encendido. */
export function mediaAvailability(killSwitches: Record<string, boolean> | undefined): { photo: boolean; video: boolean } {
  const uploads = killSwitches?.[MEDIA_KILL_SWITCHES.uploads] !== true;
  return { photo: uploads, video: uploads && killSwitches?.[MEDIA_KILL_SWITCHES.video] !== true };
}
