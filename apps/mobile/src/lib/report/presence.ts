import type { DeviceFix, PresenceSignals } from "@dizaster/contracts";

/** Subconjunto de expo-location que necesitamos (así esta lógica se prueba sin React Native). */
export interface LocationLike {
  coords: { latitude: number; longitude: number; accuracy: number | null; altitude: number | null; speed: number | null; heading: number | null };
  timestamp: number;
  mocked?: boolean;
}

/**
 * Traduce la lectura del GPS a señales de presencia. El servidor recalcula todo;
 * aquí solo se recogen datos, nunca se decide si el usuario estaba presente.
 */
export function toPresenceSignals(loc: LocationLike, recent: LocationLike[], attestationToken: string | null, now = new Date()): PresenceSignals {
  const fix: DeviceFix = {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyM: loc.coords.accuracy ?? 9999,
    altitudeM: loc.coords.altitude,
    speedMps: loc.coords.speed,
    headingDeg: loc.coords.heading,
    fixTime: new Date(loc.timestamp).toISOString(),
    // Ambos sistemas fusionan GNSS, Wi-Fi y celdas (FusedLocationProvider / CoreLocation): no hay proveedor único.
    provider: "FUSED",
  };
  return {
    fix,
    // Android: `mocked` de expo-location. iOS: `isSimulatedBySoftware` (parche local de expo-location, ADR 0195).
    // Sin dato: null = no disponible (no se asume que es real).
    mockLocation: typeof loc.mocked === "boolean" ? loc.mocked : null,
    attestationToken,
    recentFixes: recent.slice(-10).map((r) => ({ lat: r.coords.latitude, lng: r.coords.longitude, fixTime: new Date(r.timestamp).toISOString() })),
    deviceClock: now.toISOString(),
  };
}
