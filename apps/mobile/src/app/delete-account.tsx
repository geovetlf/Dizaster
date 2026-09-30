import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "../lib/api";
import { deleteConfirmed } from "../lib/auth/refresh";
import { t } from "../lib/i18n";
import { useSession } from "../lib/session";
import { colors, radius, space } from "../theme";

/**
 * Borrar la cuenta desde la app (exigido por App Store y Google Play). Explica qué pasa con cada cosa y pide
 * escribir una palabra antes de habilitar el botón: es irreversible.
 */
export default function DeleteAccountScreen() {
  const session = useSession();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = deleteConfirmed(word, t("deleteAccountWord"));

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      await session.forgetAndRestart();
      Alert.alert(t("deleteAccountDone"));
      router.dismissAll();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>{t("deleteAccountIntro")}</Text>
      {(["deleteAccountPoint1", "deleteAccountPoint2", "deleteAccountPoint3", "deleteAccountPoint4"] as const).map((k) => (
        <Text key={k} style={styles.point}>• {t(k)}</Text>
      ))}
      <TextInput
        value={word}
        onChangeText={setWord}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t("deleteAccountType")}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t("deleteAccountType")}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!ok || busy} style={[styles.button, (!ok || busy) && styles.disabled]} onPress={() => void remove()}>
        <Text style={styles.buttonText}>{t("deleteAccountButton")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  intro: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: space.xs },
  point: { color: colors.text, lineHeight: 21 },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.lg },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.md, alignItems: "center", marginTop: space.sm },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "700" },
  error: { color: colors.accentText, fontSize: 13 },
});
