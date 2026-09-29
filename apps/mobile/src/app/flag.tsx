import { FlagTargetType, type FlagReason } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { FLAG_REASONS } from "../lib/moderation/logic";
import { colors, radius, space } from "../theme";

/** Denunciar un post, comentario, evento o perfil. La persona denunciada nunca sabe quién fue. */
export default function FlagScreen() {
  const params = useLocalSearchParams<{ targetType: string; targetId: string }>();
  const type = FlagTargetType.safeParse(params.targetType);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send() {
    if (!reason || !type.success || !params.targetId) return;
    setState("sending");
    try {
      await api.flag({ targetType: type.data, targetId: params.targetId, reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <View style={[styles.container, styles.center]}>
        <Icon name="check-circle-outline" size={48} color={colors.text} />
        <Text style={styles.done}>{t("flagSent")}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>OK</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t("flagTitle")}</Text>
      {FLAG_REASONS.map((r) => (
        <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: reason === r }} style={[styles.row, reason === r && styles.rowOn]} onPress={() => setReason(r)}>
          <Icon name={reason === r ? "radiobox-marked" : "radiobox-blank"} size={22} color={reason === r ? colors.accent : colors.textMuted} />
          <Text style={styles.rowText}>{t(`reason_${r}`)}</Text>
        </Pressable>
      ))}
      <TextInput value={note} onChangeText={setNote} maxLength={500} multiline placeholder={t("flagNote")} placeholderTextColor={colors.textMuted} style={styles.input} />
      {state === "error" ? <Text style={styles.error}>{t("loadError")}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!reason || state === "sending"} style={[styles.button, (!reason || state === "sending") && styles.disabled]} onPress={() => void send()}>
        <Text style={styles.buttonText}>{t("flag")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  center: { alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.lg },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  rowOn: { borderWidth: 1, borderColor: colors.accent },
  rowText: { flex: 1, color: colors.text },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, minHeight: 80, marginTop: space.sm, textAlignVertical: "top" },
  error: { color: colors.accent, marginTop: space.sm },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.md, alignItems: "center", marginTop: space.lg, alignSelf: "stretch" },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "700" },
  done: { color: colors.text, textAlign: "center", fontSize: 16 },
});
