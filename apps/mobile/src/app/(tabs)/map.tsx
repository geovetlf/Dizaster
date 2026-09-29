import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { EventMapResponse } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { categoryStyle } from "../../lib/ui/categories";
import { parseBboxParam } from "../../lib/ui/format";
import { useCoarseLocation } from "../../lib/ui/use-coarse-location";
import { colors } from "../../theme";
import { api } from "../../lib/api";
import { limitAmbientCache } from "../../lib/map/offline";
import { t } from "../../lib/i18n";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig, type MapProvider } from "../../lib/map/provider";

/**
 * Mapa completo: el mapa base viene del proveedor configurado (estilo oscuro, como la referencia); la capa de
 * eventos viene de la API. Los puntos se colorean por categoría; los clusters, en rojo.
 */
export default function MapScreen() {
  const location = useCoarseLocation();
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [data, setData] = useState<EventMapResponse | null>(null);
  // Desde la búsqueda de lugares: /map?bbox=w,s,e,n encuadra el área elegida.
  const { bbox } = useLocalSearchParams<{ bbox?: string }>();
  const target = useMemo(() => parseBboxParam(bbox), [bbox]);
  const camera = useRef<CameraRef>(null);
  useEffect(() => {
    if (target) camera.current?.fitBounds(target, { padding: { top: 48, right: 24, bottom: 120, left: 24 }, duration: 600 });
  }, [target]);

  useEffect(() => {
    api.config().then((c) => setProvider(providerFromAppConfig(c))).catch(() => setProvider(null));
    void limitAmbientCache();
  }, []);

  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { bounds, zoom } = e.nativeEvent;
    api.events(bounds, zoom).then(setData).catch(() => undefined);
  }, []);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!data) return { type: "FeatureCollection", features: [] };
    const features: GeoJSON.Feature[] =
      data.mode === "points"
        ? data.events.map((e) => ({
            type: "Feature",
            id: e.id,
            geometry: { type: "Point", coordinates: [e.point.lng, e.point.lat] },
            properties: { id: e.id, count: 1, color: categoryStyle(e.categoryCode).color, severity: e.severity },
          }))
        : data.clusters.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.point.lng, c.point.lat] },
            properties: { count: c.count, color: colors.accent, severity: c.maxSeverity },
          }));
    return { type: "FeatureCollection", features };
  }, [data]);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={provider ? provider.styleUrl("dark") : OFFLINE_FALLBACK_STYLE}
        onRegionDidChange={onRegionDidChange}
        attribution
        logo={false}
      >
        <Camera
          ref={camera}
          key={target ? "target" : location.point ? "here" : "default"}
          initialViewState={
            target ? { bounds: target } : location.point ? { center: [location.point.lng, location.point.lat], zoom: 12 } : { center: [-75, -10], zoom: 3 }
          }
        />
        <GeoJSONSource
          id="events"
          data={geojson}
          onPress={(e) => {
            const id = e.nativeEvent.features?.[0]?.properties?.["id"];
            if (typeof id === "string") router.push(`/event/${id}`);
          }}
        >
          <Layer
            id="events-circles"
            type="circle"
            paint={{
              "circle-color": ["get", "color"],
              "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 7, 50, 22],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            }}
          />
        </GeoJSONSource>
      </Map>
      {provider ? <Text style={styles.attribution}>{provider.attribution}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={[styles.button, styles.sos]} onPress={() => router.push("/emergency")}>
          <Text style={styles.buttonText}>{t("emergency")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  attribution: { position: "absolute", bottom: 88, left: 8, fontSize: 10, color: colors.textMuted, backgroundColor: "#0B0F14AA", paddingHorizontal: 4 },
  actions: { position: "absolute", bottom: 24, left: 16, right: 16, flexDirection: "row", gap: 12 },
  button: { flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  sos: { backgroundColor: colors.accent },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
