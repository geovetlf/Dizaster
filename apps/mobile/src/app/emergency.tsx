import type { EmergencyDataset } from "@dizaster/contracts";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { lookupEmergency, label, regionOf, type EmergencyLookup } from "../lib/emergency";
import { localEmergencyDataset, refreshEmergencyDataset } from "../lib/emergency-store";
import { countryOf } from "../lib/geo/country";
import { locale, t } from "../lib/i18n";
import { colors } from "../theme";

/** País por ubicación (calculado en el teléfono); si no hay, la región de los ajustes del sistema. */
async function detectCountry(): Promise<{ country: string | null; fromSettings: boolean }> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    const pos = perm.granted
      ? ((await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })))
      : null;
    // La ubicación no sale del dispositivo.
    const country = pos ? countryOf({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : null;
    if (country) return { country, fromSettings: false };
  } catch {
    // Sin permiso o sin señal: se usa la región del teléfono.
  }
  const region = regionOf(locale);
  return { country: region, fromSettings: region !== null };
}

export default function EmergencyScreen() {
  const [lookup, setLookup] = useState<EmergencyLookup | null>(null);
  const [fromSettings, setFromSettings] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [dataset, where] = await Promise.all([localEmergencyDataset(), detectCountry()]);
      if (!alive) return;
      setFromSettings(where.fromSettings);
      setLookup(lookupEmergency(dataset, where.country));
      // Primero lo local (sin red); después, si el servidor tiene una versión más nueva, se actualiza en pantalla.
      const next: EmergencyDataset | null = await refreshEmergencyDataset();
      if (alive && next) setLookup(lookupEmergency(next, where.country));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!lookup) return <View style={styles.container} />;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("emergencyTitle")}{lookup.country ? ` · ${lookup.country}` : ""}</Text>
      {fromSettings ? <Text style={styles.hint}>{t("countryFromSettings")}</Text> : null}
      {lookup.unverified ? <Text style={styles.warning}>{t("unverifiedNumbers")}</Text> : null}
      {lookup.fallbackToGsm112 ? <Text style={styles.warning}>{t("gsmFallback")}</Text> : null}
      <FlatList
        data={lookup.fallbackToGsm112 ? [{ service: "GENERAL", number: "112", text: "112" }] : lookup.numbers.map((n) => ({ service: n.service, number: n.number, text: label(n, locale) }))}
        keyExtractor={(i) => `${i.service}-${i.number}`}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" style={styles.row} onPress={() => void Linking.openURL(`tel:${item.number}`)}>
            <Text style={styles.label}>{item.text}</Text>
            <Text style={styles.number}>{item.number}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: colors.text },
  hint: { color: colors.textMuted, marginBottom: 12 },
  warning: { backgroundColor: "#3A2A10", color: "#FACC15", padding: 10, borderRadius: 8, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  label: { fontSize: 16, flex: 1, color: colors.text },
  number: { fontSize: 22, fontWeight: "700", color: colors.accent },
});
