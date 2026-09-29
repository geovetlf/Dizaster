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
