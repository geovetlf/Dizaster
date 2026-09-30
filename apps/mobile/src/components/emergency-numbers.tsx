import type { EmergencyDataset } from "@dizaster/contracts";
import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { lookupEmergency, label, type EmergencyLookup } from "../lib/emergency";
import { localEmergencyDataset, refreshEmergencyDataset } from "../lib/emergency-store";
import type { CountrySource } from "../lib/geo/country-choice";
import { detectCountry } from "../lib/geo/device-country";
import { locale, t } from "../lib/i18n";
import { colors } from "../theme";

/** Números de emergencia, 100 % locales primero (ADR 0035). La usa la pantalla de emergencia y la pantalla de error. */
export function EmergencyNumbers({ compact = false }: { compact?: boolean }) {
  const [lookup, setLookup] = useState<EmergencyLookup | null>(null);
  const [source, setSource] = useState<CountrySource | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [dataset, where] = await Promise.all([localEmergencyDataset(), detectCountry()]);
      if (!alive) return;
      setSource(where.source);
      setLookup(lookupEmergency(dataset, where.country));
      // Primero lo local (sin red); después, si el servidor tiene una versión más nueva, se actualiza en pantalla.
      const next: EmergencyDataset | null = await refreshEmergencyDataset();
      if (alive && next) setLookup(lookupEmergency(next, where.country));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!lookup) return <View style={compact ? undefined : styles.container} />;
  return (
    <View style={compact ? styles.compact : styles.container}>
      <Text style={styles.title}>{t("emergencyTitle")}{lookup.country ? ` · ${lookup.country}` : ""}</Text>
      {source === "settings" ? <Text style={styles.hint}>{t("countryFromSettings")}</Text> : null}
      {source === "sim" ? <Text style={styles.hint}>{t("countryFromSim")}</Text> : null}
      {source === "profile" ? <Text style={styles.hint}>{t("countryFromProfile")}</Text> : null}
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
  compact: { flex: 1 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: colors.text },
  hint: { color: colors.textMuted, marginBottom: 12 },
  warning: { backgroundColor: "#3A2A10", color: "#FACC15", padding: 10, borderRadius: 8, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  label: { fontSize: 16, flex: 1, color: colors.text },
  number: { fontSize: 22, fontWeight: "700", color: colors.accent },
});
