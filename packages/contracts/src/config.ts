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

export const PlatformUpdate = z.object({ minVersion: z.string().nullable(), storeUrl: z.string().nullable() });
export type PlatformUpdate = z.infer<typeof PlatformUpdate>;

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
  /**
   * Versión mínima por plataforma (ADR 0164). Por debajo, la app no envía reportes ni publica (emergencias siempre
   * funciona) y ofrece actualizar. `null` = sin mínimo. `storeUrl` null mientras no haya ficha en la tienda.
   */
  /** Métodos de inicio de sesión disponibles (ADR 0170). */
  authProviders: z.object({ apple: z.boolean(), google: z.boolean(), email: z.boolean() }).default({ apple: false, google: false, email: false }),
  appUpdate: z.object({ android: PlatformUpdate, ios: PlatformUpdate }).default({
    android: { minVersion: null, storeUrl: null }, ios: { minVersion: null, storeUrl: null },
  }),
});
export type AppConfig = z.infer<typeof AppConfig>;

/** Cabeceras con las que la app declara su versión; el servidor las usa para exigir la mínima al escribir. */
export const APP_VERSION_HEADER = "x-app-version";
export const APP_PLATFORM_HEADER = "x-app-platform";

/** Compara versiones "1.2.10" numéricamente por partes; lo que no es número cuenta como 0. NO AI REQUIRED. */
export function compareAppVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** ¿Hay que actualizar? Sin versión conocida o sin mínimo, no: nunca se bloquea por falta de datos. */
export function isBelowMinVersion(current: string | null | undefined, min: string | null | undefined): boolean {
  if (!current || !min) return false;
  return compareAppVersions(current, min) < 0;
}

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
