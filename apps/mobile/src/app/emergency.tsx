import type { EmergencyDataset } from "@dizaster/contracts";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { lookupEmergency, label, type EmergencyLookup } from "../lib/emergency";
import { countryOf } from "../lib/geo/country";
import { locale, t } from "../lib/i18n";
import { colors } from "../theme";

// Dataset empaquetado: los números funcionan sin conexión.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dataset = require("../reference-data/emergency-numbers.json") as EmergencyDataset;

export default function EmergencyScreen() {
  const [lookup, setLookup] = useState<EmergencyLookup | null>(null);

  useEffect(() => {
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      const pos = perm.granted
        ? ((await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })))
        : null;
      // El país se calcula en el teléfono; la ubicación no sale del dispositivo.
      const country = pos ? countryOf({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : null;
      setLookup(lookupEmergency(dataset, country));
    })().catch(() => setLookup(lookupEmergency(dataset, null)));
  }, []);

  if (!lookup) return <View style={styles.container} />;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("emergencyTitle")}{lookup.country ? ` · ${lookup.country}` : ""}</Text>
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
  warning: { backgroundColor: "#3A2A10", color: "#FACC15", padding: 10, borderRadius: 8, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  label: { fontSize: 16, flex: 1, color: colors.text },
  number: { fontSize: 22, fontWeight: "700", color: colors.accent },
});
