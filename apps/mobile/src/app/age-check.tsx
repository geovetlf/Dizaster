import { ageAt } from "@dizaster/contracts";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { isAgeBlocked, setAgeBlocked } from "../lib/account/age-gate";
import { api } from "../lib/api";
import { countryOf } from "../lib/geo/country";
import { t, tf } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/**
 * Edad mínima (D-13, ADR 0049): se pide año y mes de nacimiento antes de publicar. Solo se envían al servidor para
 * comprobarlos; no se guardan. Por debajo del mínimo la app sigue sirviendo para ver y para los números de emergencia.
 */
export default function AgeCheckScreen() {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [minAge, setMinAge] = useState(16);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isAgeBlocked().then(setBlocked).catch(() => undefined);
    api.account().then((a) => setMinAge(a.minAge)).catch(() => undefined);
  }, []);

  const y = Number(year);
  const valid = /^\d{4}$/.test(year) && y > 1900 && y <= new Date().getFullYear() && month !== null;

  async function submit() {
    if (!valid || month === null) return;
    setBusy(true);
    setError(null);
    try {
      // El país (calculado en el teléfono) puede exigir más edad; la ubicación no sale del dispositivo.
      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      const country = pos ? countryOf({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : null;
      await api.confirmAge({ birthYear: y, birthMonth: month, ...(country ? { country } : {}) });
      router.back();
    } catch (e) {
      if ((e as { body?: { error?: string } }).body?.error === "UNDER_MIN_AGE" || ageAt(y, month, new Date()) < minAge) {
        await setAgeBlocked();
        setBlocked(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <View style={[styles.container, styles.content]}>
        <Text style={styles.title}>{tf("ageBlockedTitle", { age: minAge })}</Text>
        <Text style={styles.body}>{t("ageBlockedBody")}</Text>
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.replace("/emergency")}>
          <Text style={styles.primaryText}>{t("emergencyTitle")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>{t("ageBlockedBrowse")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t("ageTitle")}</Text>
      <Text style={styles.body}>{tf("ageBody", { age: minAge })}</Text>
      <Text style={styles.label}>{t("ageYear")}</Text>
      <TextInput accessibilityLabel={t("ageYear")} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" maxLength={4}
        placeholder="1995" placeholderTextColor={colors.textMuted} style={styles.input} />
      <Text style={styles.label}>{t("ageMonth")}</Text>
      <View style={styles.months}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: month === m }} onPress={() => setMonth(m)}
            style={[styles.month, month === m && styles.monthOn]}>
            <Text style={styles.monthText}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>{t("ageNotStored")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!valid || busy} onPress={() => void submit()} style={[styles.primary, (!valid || busy) && styles.disabled]}>
        <Text style={styles.primaryText}>{t("ageContinue")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  label: { color: colors.text, fontWeight: "600", marginTop: space.md },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, padding: space.md, fontSize: 18, width: 120 },
  months: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  month: { width: 48, paddingVertical: 10, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  monthOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  monthText: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.textMuted, marginTop: space.sm },
  error: { color: colors.like },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: space.lg },
  primaryText: { color: colors.white, fontWeight: "700" },
  secondary: { paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: colors.textMuted, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
