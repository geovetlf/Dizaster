import type { MyProfile, Units } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { forgetMe } from "../lib/social/me";
import { setUnits } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

const BIO_MAX = 160;

/** Editar mi perfil (ADR 0044): nombre visible, bio pública y unidades. El handle no cambia. */
export default function ProfileEditScreen() {
  const [me, setMe] = useState<MyProfile | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [units, setUnitsState] = useState<Units>("metric");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((m) => { setMe(m); setName(m.displayName); setBio(m.bio ?? ""); setUnitsState(m.units); }).catch((e: Error) => setError(e.message));
  }, []);

  async function save() {
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateMe({ displayName: name.trim(), bio: bio.trim() || null, units });
      setUnits(saved.units);
      forgetMe();
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <View style={styles.container}>{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
  const valid = name.trim().length > 0;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>@{me.handle}</Text>
      <Text style={styles.label}>{t("displayName")}</Text>
      <TextInput value={name} onChangeText={setName} maxLength={50} style={styles.input} placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>{t("bio")}</Text>
      <TextInput value={bio} onChangeText={setBio} maxLength={BIO_MAX} multiline style={[styles.input, styles.bio]}
        placeholder={t("bioPlaceholder")} placeholderTextColor={colors.textMuted} />
      <Text style={styles.hint}>{bio.length}/{BIO_MAX} · {t("bioPublic")}</Text>
      <Text style={styles.label}>{t("units")}</Text>
      <View style={styles.row}>
        {(["metric", "imperial"] as const).map((u) => (
          <Pressable key={u} accessibilityRole="button" accessibilityState={{ selected: units === u }} onPress={() => setUnitsState(u)}
            style={[styles.chip, units === u && styles.chipOn]}>
            <Text style={styles.chipText}>{t(u === "metric" ? "unitsMetric" : "unitsImperial")}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!valid || busy} onPress={() => void save()} style={[styles.save, (!valid || busy) && styles.disabled]}>
        <Text style={styles.saveText}>{t("save")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  label: { color: colors.text, fontWeight: "600", marginTop: space.md, marginBottom: space.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, padding: space.md, fontSize: 16 },
  bio: { minHeight: 90, textAlignVertical: "top" },
  hint: { color: colors.textMuted, marginTop: 4 },
  row: { flexDirection: "row", gap: space.sm },
  chip: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  error: { color: colors.like, marginTop: space.md },
  save: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: space.xl },
  saveText: { color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
