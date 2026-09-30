import { POST_TEXT_MAX } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/** Editar el texto de un post propio durante 24 h (ADR 0136). Las fotos y el evento no cambian. */
export default function PostEditScreen() {
  const params = useLocalSearchParams<{ id: string; text?: string }>();
  const [text, setText] = useState(params.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!params.id || !text.trim()) return;
    setBusy(true);
    try {
      await api.editPost(params.id, text.trim());
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>{t("editPostHint")}</Text>
      <TextInput
        style={styles.input} value={text} onChangeText={setText} multiline maxLength={POST_TEXT_MAX}
        accessibilityLabel={t("editPost")} autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy || !text.trim()} style={[styles.button, (busy || !text.trim()) && styles.disabled]} onPress={() => void save()}>
        <Text style={styles.buttonText}>{t("save")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: space.lg, gap: space.md },
  hint: { color: colors.textMuted },
  input: { minHeight: 140, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, color: colors.text, textAlignVertical: "top" },
  error: { color: colors.accentText },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.md, alignItems: "center" },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "600" },
});
