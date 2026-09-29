import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import type { EventMapResponse } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig } from "../../lib/map/provider";
import { categoryStyle } from "../../lib/ui/categories";
import { isRtlNow } from "../../lib/ui/apply-direction";
import { forwardChevron } from "../../lib/ui/direction";
import { colors, radius, space } from "../../theme";
import { Icon } from "../icon";

const ZOOM = 11;
// Área aproximada visible con zoom 11 en un recuadro de ~360×220 px.
const HALF_SPAN = { lat: 0.09, lng: 0.14 };

/** Vista previa del mapa del inicio: eventos cerca del usuario, coloreados por categoría. Toca para abrir el mapa. */
export function MapPreview({ center, category, onLocate }: { center: { lat: number; lng: number } | null; category: string | null; onLocate: () => void }) {
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [data, setData] = useState<EventMapResponse | null>(null);
  const c = center ?? { lat: -12.0464, lng: -77.0428 };

  useEffect(() => {
    api.config().then((cfg) => setStyleUrl(providerFromAppConfig(cfg)?.styleUrl("dark") ?? null)).catch(() => setStyleUrl(null));
  }, []);

  useEffect(() => {
    const bbox: [number, number, number, number] = [c.lng - HALF_SPAN.lng, c.lat - HALF_SPAN.lat, c.lng + HALF_SPAN.lng, c.lat + HALF_SPAN.lat];
    api.eventTiles(bbox, ZOOM).then(setData).catch(() => setData(null));
  }, [c.lat, c.lng]);

  const features = useMemo<GeoJSON.FeatureCollection>(() => {
    const list = data?.mode === "points" ? data.events.filter((e) => !category || e.categoryCode === category || e.categoryCode.startsWith(`${category}.`)) : [];
    return {
      type: "FeatureCollection",
      features: list.map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.point.lng, e.point.lat] },
        properties: { color: categoryStyle(e.categoryCode).color },
      })),
    };
  }, [data, category]);

  const here: GeoJSON.Feature = { type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: {} };

  return (
    <View style={styles.box}>
      <Map style={StyleSheet.absoluteFill} mapStyle={styleUrl ?? OFFLINE_FALLBACK_STYLE} logo={false} attribution attributionPosition={{ bottom: 8, left: 8 }} dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false} compass={false} onPress={() => router.push("/map")}>
        <Camera initialViewState={{ center: [c.lng, c.lat], zoom: ZOOM }} />
        <GeoJSONSource id="preview-events" data={features}>
          <Layer id="preview-events-dot" type="circle" paint={{ "circle-radius": 13, "circle-color": ["get", "color"], "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" }} />
        </GeoJSONSource>
        {center ? (
          <GeoJSONSource id="preview-me" data={here}>
            <Layer id="preview-me-dot" type="circle" paint={{ "circle-radius": 8, "circle-color": "#3B82F6", "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" }} />
          </GeoJSONSource>
        ) : null}
      </Map>
      <Pressable accessibilityRole="button" style={[styles.pill, styles.left]} onPress={() => router.push("/map")}>
        <Icon name="crosshairs-gps" size={18} color={colors.accent} />
        <Text style={styles.pillText}>{t("nearYou")}</Text>
        <Icon name={forwardChevron(isRtlNow())} size={18} color={colors.text} />
      </Pressable>
      <Pressable accessibilityRole="button" style={[styles.pill, styles.right]} onPress={() => router.push("/map")}>
        <Icon name="arrow-expand" size={16} color={colors.text} />
        <Text style={styles.pillText}>{t("fullMap")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("enableLocation")} style={styles.locate} onPress={onLocate}>
        <Icon name="navigation-variant" size={22} color="#111" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 220, borderRadius: radius.lg, overflow: "hidden", marginTop: space.lg, backgroundColor: colors.surface },
  pill: { position: "absolute", top: space.md, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#0B0F14E6", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8 },
  left: { start: space.md },
  right: { end: space.md },
  pillText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  locate: { position: "absolute", end: space.md, bottom: space.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "#F2F4F7", alignItems: "center", justifyContent: "center" },
});
