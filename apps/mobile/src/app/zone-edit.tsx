import { ZONE_RADII_KM, type AreaSearchResult, type SavedZoneKind } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { ZONE_KINDS } from "../lib/alerts/logic";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { areaRow, formatKm } from "../lib/ui/format";
import { useCoarseLocation } from "../lib/ui/use-coarse-location";
import { colors, radius, space } from "../theme";

/**
 * Nueva zona guardada (casa, trabajo, familia…): tipo, nombre privado opcional, radio y punto. El punto sale de
 * la ubicación actual o de un lugar buscado; el servidor lo reduce a una celda de ~0,7 km² antes de guardarlo.
 */
export default function ZoneEditScreen() {
  const [kind, setKind] = useState<SavedZoneKind>("HOME");
  const [name, setName] = useState("");
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [point, setPoint] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [q, setQ] = useState("");
  const [areas, setAreas] = useState<AreaSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const location = useCoarseLocation();

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setAreas([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      api.areas(text, location.point).then((r) => { if (live) setAreas(r.areas); }).catch(() => { if (live) setAreas([]); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, location.point]);

  async function useHere() {
    if (!location.granted) await location.request();
    if (location.point) setPoint({ ...location.point, label: t("zoneHere") });
  }

  // Si el permiso se concede tras pedirlo, el punto llega después: se usa en cuanto está.
  useEffect(() => {
    if (point === null && location.granted && location.point) setPoint({ ...location.point, label: t("zoneHere") });
  }, [location.granted, location.point, point]);

  async function save() {
    if (!point) return;
    try {
      await api.addZone({ kind, name: name.trim() || null, lat: point.lat, lng: point.lng, radiusKm });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        {ZONE_KINDS.map((k) => (
          <Pressable key={k.kind} accessibilityRole="button" accessibilityState={{ selected: kind === k.kind }} style={[styles.chip, kind === k.kind && styles.chipOn]} onPress={() => setKind(k.kind)}>
            <Icon name={k.icon} size={16} color={colors.text} />
            <Text style={styles.chipText}>{t(k.label)}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={name} onChangeText={setName} maxLength={40} placeholder={t("zoneName")} placeholderTextColor={colors.textMuted} style={styles.input} />

      <Text style={styles.section}>{t("zoneRadius")}</Text>
      <View style={styles.chips}>
        {ZONE_RADII_KM.map((r) => (
          <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: radiusKm === r }} style={[styles.chip, radiusKm === r && styles.chipOn]} onPress={() => setRadiusKm(r)}>
            <Text style={styles.chipText}>{formatKm(r)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>{t("zonePlace")}</Text>
      {point ? (
        <View style={styles.row}>
          <Icon name="map-marker-check-outline" size={22} color={colors.accent} />
          <Text style={styles.label}>{point.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} hitSlop={8} onPress={() => setPoint(null)}>
            <Icon name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <>
          <Pressable accessibilityRole="button" style={styles.row} onPress={() => void useHere()}>
            <Icon name="crosshairs-gps" size={22} color={colors.text} />
            <Text style={styles.label}>{t("zoneUseHere")}</Text>
          </Pressable>
          <TextInput value={q} onChangeText={setQ} placeholder={t("chooseArea")} placeholderTextColor={colors.textMuted} style={styles.input} />
          {areas.map((a) => {
            const r = areaRow(a);
            return (
              <Pressable key={a.id} accessibilityRole="button" style={styles.row} onPress={() => { setPoint({ ...a.center, label: r.title }); setQ(""); }}>
                <Icon name="map-marker" size={22} color={colors.textMuted} />
                <View style={styles.label}>
                  <Text style={styles.labelText}>{r.title}</Text>
                  <Text style={styles.value}>{r.subtitle}</Text>
                </View>
              </Pressable>
            );
          })}
        </>
      )}
      <Text style={styles.note}>{t("zonePrivacy")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!point} style={[styles.button, !point && styles.disabled]} onPress={() => void save()}>
        <Text style={styles.buttonText}>{t("saveZone")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm },
  label: { flex: 1, color: colors.text, fontSize: 15 },
  labelText: { color: colors.text, fontSize: 15 },
  value: { color: colors.textMuted },
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: space.lg, marginBottom: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12, marginBottom: space.sm },
  note: { color: colors.textMuted, fontSize: 13, marginVertical: space.md },
  error: { color: colors.accent, fontSize: 13 },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.md, alignItems: "center" },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "700" },
});
