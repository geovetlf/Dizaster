import { Camera, GeoJSONSource, Layer, Map, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { EventMapResponse } from "@dizaster/contracts";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme, type NativeSyntheticEvent } from "react-native";
import { api } from "../lib/api";
import { t, VERIFICATION_LABEL } from "../lib/i18n";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig, type MapProvider } from "../lib/map/provider";

/** Mapa: el mapa base viene del proveedor configurado; la capa de eventos viene de la API (desacoplados). */
export default function MapScreen() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [data, setData] = useState<EventMapResponse | null>(null);

  useEffect(() => {
    api.config().then((c) => setProvider(providerFromAppConfig(c))).catch(() => setProvider(null));
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
            properties: { id: e.id, count: 1, color: VERIFICATION_LABEL[e.publicVerificationState]?.color ?? "#8a94a6", severity: e.severity },
          }))
        : data.clusters.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.point.lng, c.point.lat] },
            properties: { count: c.count, color: "#d64545", severity: c.maxSeverity },
          }));
    return { type: "FeatureCollection", features };
  }, [data]);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={provider ? provider.styleUrl(scheme) : OFFLINE_FALLBACK_STYLE}
        onRegionDidChange={onRegionDidChange}
        attribution
        logo={false}
      >
        <Camera initialViewState={{ center: [-75, -10], zoom: 3 }} />
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
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push("/report")}>
          <Text style={styles.buttonText}>{t("report")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  attribution: { position: "absolute", bottom: 88, left: 8, fontSize: 10, color: "#444", backgroundColor: "#ffffffaa", paddingHorizontal: 4 },
  actions: { position: "absolute", bottom: 24, left: 16, right: 16, flexDirection: "row", gap: 12 },
  button: { flex: 1, backgroundColor: "#1f2937", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  sos: { backgroundColor: "#c62828" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
