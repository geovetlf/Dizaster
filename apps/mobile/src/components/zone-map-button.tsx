import type { SavedZone } from "@dizaster/contracts";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { t } from "../lib/i18n";
import { deleteZoneMap, downloadZoneMap, zoneMapStates, type ZoneMapState } from "../lib/map/offline";
import { planZonePack } from "../lib/map/offline-plan";
import { colors } from "../theme";
import { Icon } from "./icon";

/** Botón "mapa sin conexión" de una zona guardada (ADR 0041). Sin estilo de proveedor no se muestra. */
export function ZoneMapButton({ zone, styleUrl }: { zone: SavedZone; styleUrl: string | null }) {
  const [state, setState] = useState<ZoneMapState>({ kind: "none" });

  useEffect(() => {
    zoneMapStates([zone.id]).then((s) => setState(s[zone.id] ?? { kind: "none" })).catch(() => undefined);
  }, [zone.id]);

  if (!styleUrl) return null;

  function onPress(style: string) {
    if (state.kind === "downloading") return;
    if (state.kind === "ready") {
      Alert.alert(t("offlineMap"), t("offlineMapReady").replace("{mb}", String(state.mb)), [
        { text: t("cancel"), style: "cancel" },
        { text: t("offlineMapDelete"), style: "destructive", onPress: () => void deleteZoneMap(zone.id).then(() => setState({ kind: "none" })) },
      ]);
      return;
    }
    const plan = planZonePack(zone.center, zone.radiusKm);
    Alert.alert(t("offlineMap"), t("offlineMapConfirm").replace("{mb}", String(plan.estimatedMb)), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("offlineMapDownload"),
        onPress: () => {
          setState({ kind: "downloading", percent: 0 });
          downloadZoneMap(zone, style, setState).catch(() => setState({ kind: "error" }));
        },
      },
    ]);
  }

  const label = state.kind === "downloading" ? `${state.percent}%` : null;
  const icon = state.kind === "ready" ? "map-check" : state.kind === "error" ? "map-marker-alert-outline" : "download-outline";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("offlineMap")} hitSlop={8} onPress={() => onPress(styleUrl)} style={styles.btn}>
      {label ? <Text style={styles.pct}>{label}</Text> : <Icon name={icon} size={20} color={state.kind === "ready" ? colors.accent : colors.textMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 36, alignItems: "center" },
  pct: { color: colors.textMuted, fontSize: 12 },
});
