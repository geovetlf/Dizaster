import type { AffectedAreaView } from "@dizaster/contracts";
import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { areaBounds } from "../lib/map/area";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig } from "../lib/map/provider";
import { colors, radius, space } from "../theme";

/**
 * Área oficial afectada en la ficha del evento (ADR 0144): contorno que dieron fuentes externas u oficiales y el
 * punto del evento. Estático (sin gestos) para no competir con el desplazamiento de la pantalla.
 */
export function EventAreaMap({ area, point, color }: { area: AffectedAreaView; point: { lat: number; lng: number }; color: string }) {
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  useEffect(() => {
    api.config().then((cfg) => setStyleUrl(providerFromAppConfig(cfg)?.styleUrl("dark") ?? null)).catch(() => setStyleUrl(null));
  }, []);
  const bounds = useMemo(() => areaBounds(area, point), [area, point]);
  const shape = useMemo<GeoJSON.Feature>(() => ({ type: "Feature", geometry: area, properties: {} }), [area]);
  const here = useMemo<GeoJSON.Feature>(() => ({ type: "Feature", geometry: { type: "Point", coordinates: [point.lng, point.lat] }, properties: {} }), [point]);
  if (!bounds) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("affectedArea")}</Text>
      <View style={styles.box} accessible accessibilityLabel={t("affectedArea")}>
        <Map style={StyleSheet.absoluteFill} mapStyle={styleUrl ?? OFFLINE_FALLBACK_STYLE} logo={false} attribution attributionPosition={{ bottom: 8, left: 8 }}
          dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false} compass={false}>
          <Camera initialViewState={{ bounds, padding: { top: 16, right: 16, bottom: 16, left: 16 } }} />
          <GeoJSONSource id="event-area" data={shape}>
            <Layer id="event-area-fill" type="fill" paint={{ "fill-color": color, "fill-opacity": 0.2 }} />
            <Layer id="event-area-line" type="line" paint={{ "line-color": color, "line-width": 2 }} />
          </GeoJSONSource>
          <GeoJSONSource id="event-area-point" data={here}>
            <Layer id="event-area-dot" type="circle" paint={{ "circle-radius": 7, "circle-color": color, "circle-stroke-width": 2, "circle-stroke-color": "#FFFFFF" }} />
          </GeoJSONSource>
        </Map>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { color: colors.textMuted, fontWeight: "600" },
  box: { height: 180, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface },
});
