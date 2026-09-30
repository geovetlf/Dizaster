import { OfflineManager, type OfflinePack } from "@maplibre/maplibre-react-native";
import type { SavedZone } from "@dizaster/contracts";
import { packFingerprint, planZonePack } from "./offline-plan";

/** Caché automática de teselas vistas: acotada para no llenar el teléfono. */
const AMBIENT_CACHE_BYTES = 50 * 1024 * 1024;

export type ZoneMapState = { kind: "none" } | { kind: "downloading"; percent: number } | { kind: "ready"; mb: number } | { kind: "outdated"; mb: number } | { kind: "error" };

const zoneIdOf = (p: OfflinePack) => (typeof p.metadata?.["zoneId"] === "string" ? (p.metadata["zoneId"] as string) : null);

export async function limitAmbientCache(): Promise<void> {
  await OfflineManager.setMaximumAmbientCacheSize(AMBIENT_CACHE_BYTES).catch(() => undefined);
}

async function packOf(zoneId: string): Promise<OfflinePack | null> {
  const packs = await OfflineManager.getPacks();
  return packs.find((p) => zoneIdOf(p) === zoneId) ?? null;
}

/**
 * Estado del mapa sin conexión de cada zona guardada. `expected`: huella actual de cada zona (ADR 0250); un mapa
 * completo con otra huella (zona editada, otro idioma o descargado antes de guardar huellas) está desactualizado.
 */
export async function zoneMapStates(zoneIds: string[], expected: Record<string, string> = {}): Promise<Record<string, ZoneMapState>> {
  const out: Record<string, ZoneMapState> = Object.fromEntries(zoneIds.map((id) => [id, { kind: "none" } as ZoneMapState]));
  for (const p of await OfflineManager.getPacks()) {
    const id = zoneIdOf(p);
    if (!id || !(id in out)) continue;
    const s = await p.status();
    const mb = Math.round(s.completedResourceSize / 1e6);
    const stale = expected[id] !== undefined && p.metadata?.["fingerprint"] !== expected[id];
    out[id] = s.state !== "complete" ? { kind: "downloading", percent: Math.floor(s.percentage) } : stale ? { kind: "outdated", mb } : { kind: "ready", mb };
  }
  return out;
}

/**
 * Descarga el mapa de la zona con el estilo del proveedor configurado (MapLibre offline packs). Solo el mapa
 * base: los eventos siguen llegando por la API cuando hay red. Reemplaza una descarga previa de la misma zona.
 */
export async function downloadZoneMap(zone: SavedZone, styleUrl: string, onState: (s: ZoneMapState) => void): Promise<void> {
  await deleteZoneMap(zone.id);
  const plan = planZonePack(zone.center, zone.radiusKm);
  await OfflineManager.createPack(
    { mapStyle: styleUrl, bounds: plan.bounds, minZoom: plan.minZoom, maxZoom: plan.maxZoom, metadata: { zoneId: zone.id, fingerprint: packFingerprint(zone, styleUrl) } },
    (_pack, s) => onState(s.state === "complete" ? { kind: "ready", mb: Math.round(s.completedResourceSize / 1e6) } : { kind: "downloading", percent: Math.floor(s.percentage) }),
    () => onState({ kind: "error" }),
  );
}

/** Borra el mapa de la zona (al quitar la zona o a petición). */
export async function deleteZoneMap(zoneId: string): Promise<void> {
  const p = await packOf(zoneId).catch(() => null);
  if (p) await OfflineManager.deletePack(p.id).catch(() => undefined);
}
