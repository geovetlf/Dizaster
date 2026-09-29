import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";

export interface CoarseLocation {
  point: { lat: number; lng: number } | null;
  granted: boolean;
  request: () => Promise<void>;
}

/**
 * Ubicación aproximada para el inicio ("cerca de ti" y el mapa). No pide permiso al abrir: solo si el
 * usuario lo activa. Usa la última posición conocida (rápida y sin gastar batería) y, si no hay, una de baja precisión.
 */
export function useCoarseLocation(): CoarseLocation {
  const [point, setPoint] = useState<CoarseLocation["point"]>(null);
  const [granted, setGranted] = useState(false);

  const read = useCallback(async () => {
    const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    if (pos) setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  }, []);

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(async (p) => {
        setGranted(p.granted);
        if (p.granted) await read();
      })
      .catch(() => undefined);
  }, [read]);

  const request = useCallback(async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    setGranted(p.granted);
    if (p.granted) await read();
  }, [read]);

  return { point, granted, request };
}
