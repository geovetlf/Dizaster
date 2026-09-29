import { MAX_SAVED_ZONES, type AlertPreferences, type AreaSearchResult, type CategorySubscription, type SavedZone } from "@dizaster/contracts";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { ZoneMapButton } from "../components/zone-map-button";
import { cycle, zonePrefsSummary, QUIET_PRESETS, quietLabel, sameQuiet, zoneKindInfo, zoneTitle, type PermissionView } from "../lib/alerts/logic";
import { sendNearMe, setNearMeEnabled } from "../lib/alerts/notifications";
import { api } from "../lib/api";
import { enablePush, openSystemSettings, pushPermission } from "../lib/device/push";
import { countryOf } from "../lib/geo/country";
import { preferredCountry } from "../lib/geo/preferred-country";
import { deleteZoneMap } from "../lib/map/offline";
import { providerFromAppConfig } from "../lib/map/provider";
import { t, type MessageKey } from "../lib/i18n";
import { useSession } from "../lib/session";
import { categoryStyle } from "../lib/ui/categories";
import { areaRow, formatKm } from "../lib/ui/format";
import { useCoarseLocation } from "../lib/ui/use-coarse-location";
import { colors, radius, space } from "../theme";
import { categoryLabel, pickerCategories, useCategoryCatalogVersion } from "../lib/category-store";

const categoryName = categoryLabel;

const SEVERITIES = [1, 2, 3, 4, 5] as const;
const PER_HOUR = [2, 4, 6, 10, 20] as const;
const TOGGLES: { key: "followedEvents" | "followedPlaces" | "categories" | "statusChanges" | "mentions"; label: MessageKey }[] = [
  { key: "followedEvents", label: "prefFollowedEvents" },
  { key: "followedPlaces", label: "prefFollowedPlaces" },
  { key: "categories", label: "prefCategories" },
  { key: "statusChanges", label: "prefStatusChanges" },
  { key: "mentions", label: "prefMentions" },
];

/** Qué alertas recibe esta persona. Todo se guarda en el servidor: vale para cualquier teléfono con su cuenta. */
export default function AlertSettingsScreen() {
  const session = useSession();
  const [permission, setPermission] = useState<PermissionView | null>(null);
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null);
  const [subs, setSubs] = useState<CategorySubscription[]>([]);
  const [zones, setZones] = useState<SavedZone[]>([]);
  const [error, setError] = useState(false);
  const [offlineStyle, setOfflineStyle] = useState<string | null>(null);

  useEffect(() => {
    // Solo si el proveedor de mapa permite descargas por región (config remota).
    api.config()
      .then((c) => setOfflineStyle(c.map.kind !== "NONE" && c.map.offlineRegions ? providerFromAppConfig(c)?.styleUrl("light") ?? null : null))
      .catch(() => setOfflineStyle(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      pushPermission().then(setPermission).catch(() => setPermission("ask"));
      Promise.all([api.alertPreferences(), api.alertSubscriptions(), api.zones()])
        .then(([p, s, z]) => { setPrefs(p); setSubs(s.subscriptions); setZones(z.zones); setError(false); })
        .catch(() => setError(true));
    }, []),
  );

  async function askPermission() {
    if (permission === "blocked") return openSystemSettings();
    if (!session.deviceId) return;
    await enablePush(session.deviceId).catch(() => false);
    setPermission(await pushPermission().catch(() => "ask" as const));
  }

  /** Cambio optimista: se ve al instante y se revierte si el servidor lo rechaza. */
  async function update(patch: Partial<AlertPreferences>) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      setPrefs(await api.updateAlertPreferences(patch));
    } catch {
      setPrefs(before);
    }
  }

  /** "Cerca de mí" necesita permiso de ubicación mientras se usa la app (nunca en segundo plano). */
  async function toggleNearMe(on: boolean) {
    if (on) {
      const p = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!p?.granted) return;
    }
    await update({ nearMe: on });
    setNearMeEnabled(on);
    if (on) await sendNearMe(true);
  }

  async function removeZone(id: string) {
    setZones(zones.filter((z) => z.id !== id));
    await deleteZoneMap(id).catch(() => undefined);
    await api.removeZone(id).catch(() => undefined);
  }

  if (!prefs) {
    return <View style={styles.container}><Text style={styles.note}>{error ? t("loadError") : ""}</Text></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.row}>
        <Icon name="bell-outline" size={22} color={colors.text} />
        <Text style={styles.label}>{t("permission")}</Text>
        {permission === "granted" ? (
          <Text style={styles.value}>{t("alertsOn")}</Text>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void askPermission()}>
            <Text style={styles.action}>{permission === "blocked" ? t("permissionBlocked") : t("permissionAsk")}</Text>
          </Pressable>
        )}
      </View>
      {permission === "blocked" ? <Text style={styles.note}>{t("permissionBlockedNote")}</Text> : null}

      <SwitchRow label={t("alertsEnabled")} value={prefs.enabled} onChange={(v) => void update({ enabled: v })} />
      {prefs.enabled ? (
        <>
          {TOGGLES.map((x) => (
            <SwitchRow key={x.key} label={t(x.label)} value={prefs[x.key]} onChange={(v) => void update({ [x.key]: v })} />
          ))}
          <CycleRow label={t("prefMinSeverity")} value={`${prefs.minSeverity}/5`} onPress={() => void update({ minSeverity: cycle(SEVERITIES, prefs.minSeverity as (typeof SEVERITIES)[number]) })} />
          <CycleRow label={t("prefMaxPerHour")} value={String(prefs.maxPerHour)} onPress={() => void update({ maxPerHour: cycle(PER_HOUR, prefs.maxPerHour as (typeof PER_HOUR)[number]) })} />
          <CycleRow
            label={t("prefQuietHours")}
            value={quietLabel(prefs.quietHours, t("quietOff"))}
            onPress={() => void update({ quietHours: cycle(QUIET_PRESETS, prefs.quietHours, sameQuiet) })}
          />
          <Text style={styles.note}>{t("quietNote")}</Text>
          <Text style={styles.section}>{t("zonesTitle")}</Text>
          <SwitchRow label={t("prefSavedZones")} value={prefs.savedZones} onChange={(v) => void update({ savedZones: v })} />
          {zones.map((z) => {
            const k = zoneKindInfo(z.kind);
            return (
              <View key={z.id} style={styles.row}>
                <Icon name={k.icon} size={22} color={colors.text} />
                <Pressable accessibilityRole="button" style={styles.label} onPress={() => router.push({ pathname: "/zone-edit", params: { id: z.id } })}>
                  <Text style={styles.labelText}>{zoneTitle(z, t)} · {formatKm(z.radiusKm)}</Text>
                  {zonePrefsSummary(z, categoryName) ? <Text style={styles.sub}>{zonePrefsSummary(z, categoryName)}</Text> : null}
                </Pressable>
                <ZoneMapButton zone={z} styleUrl={offlineStyle} />
                <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} hitSlop={8} onPress={() => void removeZone(z.id)}>
                  <Icon name="close" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
          {zones.length < MAX_SAVED_ZONES ? (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push("/zone-edit")}>
              <Icon name="plus" size={22} color={colors.accent} />
              <Text style={[styles.label, styles.action]}>{t("addZone")}</Text>
            </Pressable>
          ) : null}
          <SwitchRow label={t("prefNearMe")} value={prefs.nearMe} onChange={(v) => void toggleNearMe(v)} />
          <Text style={styles.note}>{t("nearMeNote")}</Text>
          <Subscriptions subs={subs} onChange={setSubs} />
        </>
      ) : null}
      <Text style={styles.note}>{t("privacyAlerts")}</Text>
    </ScrollView>
  );
}

function Subscriptions({ subs, onChange }: { subs: CategorySubscription[]; onChange: (s: CategorySubscription[]) => void }) {
  const catalogVersion = useCategoryCatalogVersion();
  const ROOTS = useMemo(() => pickerCategories().filter((c) => !c.parent), [catalogVersion]);
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [areas, setAreas] = useState<AreaSearchResult[]>([]);
  const location = useCoarseLocation();
  // Sin ubicación se ofrece el país preferido del perfil (ADR 0085).
  const country = (location.point ? countryOf(location.point) : null) ?? preferredCountry();

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setAreas([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      api.areas(text, location.point).then((r) => { if (live) setAreas(r.areas); }).catch(() => { if (live) setAreas([]); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, location.point]);

  async function add(areaId: string) {
    if (!category) return;
    const created = await api.addAlertSubscription({ categoryCode: category, areaId }).catch(() => null);
    if (!created) return;
    onChange([...subs.filter((s) => s.id !== created.id), created]);
    setCategory(null);
    setQ("");
  }

  async function remove(id: string) {
    onChange(subs.filter((s) => s.id !== id));
    await api.removeAlertSubscription(id).catch(() => undefined);
  }

  return (
    <View>
      <Text style={styles.section}>{t("subscriptions")}</Text>
      {subs.map((s) => {
        const st = categoryStyle(s.categoryCode);
        return (
          <View key={s.id} style={styles.row}>
            <Icon name={st.icon} size={22} color={st.color} />
            <Text style={styles.label}>{categoryName(s.categoryCode)} · {s.areaName}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} hitSlop={8} onPress={() => void remove(s.id)}>
              <Icon name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        );
      })}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {ROOTS.map((c) => {
          const st = categoryStyle(c.code);
          const on = category === c.code;
          return (
            <Pressable key={c.code} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(on ? null : c.code)}>
              <Icon name={st.icon} size={16} color={st.color} />
              <Text style={styles.chipText}>{categoryName(c.code)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {category ? (
        <View>
          {country ? (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => void add(country)}>
              <Icon name="earth" size={22} color={colors.text} />
              <Text style={styles.label}>{t("wholeCountry")} ({country})</Text>
              <Text style={styles.action}>{t("addSubscription")}</Text>
            </Pressable>
          ) : null}
          <TextInput value={q} onChangeText={setQ} placeholder={t("chooseArea")} placeholderTextColor={colors.textMuted} style={styles.input} />
          {areas.map((a) => {
            const r = areaRow(a);
            return (
              <Pressable key={a.id} accessibilityRole="button" style={styles.row} onPress={() => void add(a.id)}>
                <Icon name="map-marker" size={22} color={colors.textMuted} />
                <View style={styles.label}>
                  <Text style={styles.labelText}>{r.title}</Text>
                  <Text style={styles.value}>{r.subtitle}</Text>
                </View>
                <Text style={styles.action}>{t("addSubscription")}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} />
    </View>
  );
}

function CycleRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityHint={label} style={styles.row} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.action}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm },
  label: { flex: 1, color: colors.text, fontSize: 15 },
  labelText: { color: colors.text, fontSize: 15 },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  value: { color: colors.textMuted },
  action: { color: colors.accent, fontWeight: "600" },
  note: { color: colors.textMuted, fontSize: 13, marginBottom: space.md },
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: space.lg, marginBottom: space.sm },
  chips: { gap: space.sm, paddingVertical: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12, marginBottom: space.sm },
});
