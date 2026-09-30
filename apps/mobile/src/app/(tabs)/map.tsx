import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { EventMapResponse } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { categoryStyle, homeChips } from "../../lib/ui/categories";
import { VERIFICATION_STROKE, clusterZoom, mapFilterQuery, mapListOrder, nextMapWindow, pointOpacity, type MapFilter } from "../../lib/map/event-style";
import { parseBboxParam } from "../../lib/ui/format";
import { useCoarseLocation } from "../../lib/ui/use-coarse-location";
import { colors } from "../../theme";
import { api } from "../../lib/api";
import { OfflineNote } from "../../components/offline-note";
import { cacheKeys, readThrough } from "../../lib/offline/read-cache";
import { readCache } from "../../lib/offline/sqlite-cache";
import { limitAmbientCache } from "../../lib/map/offline";
import { lang, t, verificationLabel } from "../../lib/i18n";
import { useReduceMotion } from "../../lib/a11y/announce";
import { APP_MAP_SCHEME, OFFLINE_FALLBACK_STYLE, providerFromAppConfig, type MapProvider } from "../../lib/map/provider";
import { categoryCatalog, categoryLabel, pickerCategories, useCategoryCatalogVersion } from "../../lib/category-store";
import { appConfig } from "../../lib/config/app-config";


/**
 * Mapa completo: el mapa base viene del proveedor configurado (estilo oscuro, como la referencia); la capa de
 * eventos viene de la API. El relleno de un punto es su categoría y el borde, su verificación; los clusters, en rojo.
 * Filtros por categoría raíz y "solo verificados" (ADR 0057).
 */
export default function MapScreen() {
  const location = useCoarseLocation();
  const catalogVersion = useCategoryCatalogVersion();
  const { chips } = useMemo(() => homeChips({ ...categoryCatalog(), categories: pickerCategories() }), [catalogVersion]);
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [data, setData] = useState<EventMapResponse | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<MapFilter>({ category: null, verifiedOnly: false });
  const view = useRef<{ bounds: [number, number, number, number]; zoom: number } | null>(null);
  // Desde la búsqueda de lugares: /map?bbox=w,s,e,n encuadra el área elegida.
  const { bbox } = useLocalSearchParams<{ bbox?: string }>();
  const target = useMemo(() => parseBboxParam(bbox), [bbox]);
  const camera = useRef<CameraRef>(null);
  // Mapa accesible (ADR 0200): lista de lo que hay en la vista y grupos que se acercan al tocarlos.
  const [listMode, setListMode] = useState(false);
  const reduceMotion = useReduceMotion();
  const listed = useMemo(() => (data?.mode === "points" ? mapListOrder(data.events) : []), [data]);
  useEffect(() => {
    if (target) camera.current?.fitBounds(target, { padding: { top: 48, right: 24, bottom: 120, left: 24 }, duration: 600 });
  }, [target]);

  useEffect(() => {
    appConfig().then((c) => setProvider(providerFromAppConfig(c))).catch(() => setProvider(null));
    void limitAmbientCache();
  }, []);

  const load = useCallback((f: MapFilter) => {
    if (!view.current) return;
    // Sin red, el mapa muestra la última vista guardada en lugar de quedar vacío (ADR 0066). Solo se guarda la vista
    // sin filtros, que es la que sirve de respaldo.
    const q = mapFilterQuery(f);
    const fetcher = () => api.eventTiles(view.current!.bounds, view.current!.zoom, q);
    (q ? fetcher().then((value) => ({ value, savedAt: null })) : readThrough(readCache(), cacheKeys.map, fetcher))
      .then(({ value, savedAt }) => { setData(value); setSavedAt(savedAt); })
      .catch(() => undefined);
  }, []);
  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { bounds, zoom } = e.nativeEvent;
    view.current = { bounds, zoom };
    load(filter);
  }, [filter, load]);
  const applyFilter = (f: MapFilter) => { setFilter(f); load(f); };

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!data) return { type: "FeatureCollection", features: [] };
    const features: GeoJSON.Feature[] =
      data.mode === "points"
        ? data.events.map((e) => ({
            type: "Feature",
            id: e.id,
            geometry: { type: "Point", coordinates: [e.point.lng, e.point.lat] },
            properties: {
              id: e.id, count: 1, color: categoryStyle(e.categoryCode).color, severity: e.severity,
              stroke: VERIFICATION_STROKE[e.publicVerificationState].color,
              strokeWidth: VERIFICATION_STROKE[e.publicVerificationState].width,
              opacity: pointOpacity(e.publicVerificationState, e.status),
            },
          }))
        : data.clusters.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.point.lng, c.point.lat] },
            properties: { cluster: 1, count: c.count, color: colors.accent, severity: c.maxSeverity, stroke: "#ffffff", strokeWidth: 2, opacity: 1 },
          }));
    return { type: "FeatureCollection", features };
  }, [data]);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={provider ? provider.styleUrl(APP_MAP_SCHEME) : OFFLINE_FALLBACK_STYLE}
        onRegionDidChange={onRegionDidChange}
        attribution
        logo={false}
        accessibilityLabel={t("mapA11y")}
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
            const f = e.nativeEvent.features?.[0];
            const id = f?.properties?.["id"];
            if (typeof id === "string") return router.push(`/event/${id}`);
            if (f?.properties?.["cluster"] && f.geometry.type === "Point") {
              const [lng, lat] = f.geometry.coordinates as [number, number];
              camera.current?.easeTo({ center: [lng, lat], zoom: clusterZoom(view.current?.zoom ?? 5), duration: reduceMotion ? 0 : 400 });
            }
          }}
        >
          <Layer
            id="events-circles"
            type="circle"
            paint={{
              "circle-color": ["get", "color"],
              "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 7, 50, 22],
              "circle-stroke-width": ["get", "strokeWidth"],
              "circle-stroke-color": ["get", "stroke"],
              "circle-opacity": ["get", "opacity"],
            }}
          />
        </GeoJSONSource>
      </Map>
      <SafeAreaView edges={["top"]} style={styles.filters} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: filter.verifiedOnly }}
            style={[styles.chip, filter.verifiedOnly && styles.chipOn]} onPress={() => applyFilter({ ...filter, verifiedOnly: !filter.verifiedOnly })}>
            <Text style={styles.chipText}>{filter.verifiedOnly ? "✓ " : ""}{t("verifiedOnly")}</Text>
          </Pressable>
          {/* Ventana de tiempo (ADR 0123): cada toque pasa a la siguiente. */}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !!filter.window }} accessibilityHint={t("mapWindowHint")}
            style={[styles.chip, !!filter.window && styles.chipOn]} onPress={() => applyFilter({ ...filter, window: nextMapWindow(filter.window) })}>
            <Text style={styles.chipText}>{t(filter.window ? `mapWindow_${filter.window}` : "mapWindowAny")}</Text>
          </Pressable>
          {chips.map((c) => {
            const on = filter.category === c.code;
            return (
              <Pressable key={c.code ?? "all"} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[styles.chip, on && styles.chipOn]} onPress={() => applyFilter({ ...filter, category: c.code })}>
                <Text style={styles.chipText}>{c.label[lang]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {savedAt ? <View style={styles.offline}><OfflineNote savedAt={savedAt} /></View> : null}
      </SafeAreaView>
      {provider ? <Text style={styles.attribution}>{provider.attribution}</Text> : null}
      {listMode ? (
        <View style={styles.listPanel}>
          {data?.mode === "clusters" ? <Text style={styles.listNote}>{t("mapClustersHint")}</Text> : null}
          <FlatList
            data={listed}
            keyExtractor={(e) => e.id}
            ListEmptyComponent={data?.mode === "clusters" ? null : <Text style={styles.listNote}>{t("mapListEmpty")}</Text>}
            renderItem={({ item: e }) => (
              <Pressable accessibilityRole="button" style={styles.listRow} onPress={() => router.push(`/event/${e.id}`)}>
                <Text style={styles.listTitle}>{e.title?.[lang] ?? e.title?.["es"] ?? categoryLabel(e.categoryCode)}</Text>
                <Text style={styles.listMeta}>{[e.place?.label, verificationLabel(e.publicVerificationState)].filter(Boolean).join(" · ")}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: listMode }} style={[styles.button, styles.listButton]} onPress={() => setListMode(!listMode)}>
          <Text style={styles.buttonText}>{listMode ? t("mapShowMap") : t("mapShowList")}</Text>
        </Pressable>
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
  filters: { position: "absolute", top: 0, left: 0, right: 0 },
  offline: { paddingHorizontal: 12 },
  chipRow: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chip: { backgroundColor: "#0B0F14CC", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: "#fff", fontWeight: "600" },
  attribution: { position: "absolute", bottom: 88, left: 8, fontSize: 10, color: colors.textMuted, backgroundColor: "#0B0F14AA", paddingHorizontal: 4 },
  actions: { position: "absolute", bottom: 24, left: 16, right: 16, flexDirection: "row", gap: 12 },
  button: { flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  sos: { backgroundColor: colors.accent },
  listButton: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  listPanel: { position: "absolute", top: 104, bottom: 92, left: 12, right: 12, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  listNote: { color: colors.textMuted, padding: 12 },
  listRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  listTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  listMeta: { color: colors.textMuted, marginTop: 2 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
