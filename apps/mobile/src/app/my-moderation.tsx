import type { ModerationNotice } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { validReason } from "../lib/moderation/logic";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/** Transparencia: qué se hizo con mi contenido o mi cuenta, por qué, y apelación (la revisa otra persona). */
export default function MyModerationScreen() {
  const [notices, setNotices] = useState<ModerationNotice[]>([]);
  useFocusEffect(useCallback(() => { api.myModeration().then((r) => setNotices(r.notices)).catch(() => undefined); }, []));
  return (
    <FlatList
      style={styles.container}
      data={notices}
      keyExtractor={(n) => n.action.id}
      renderItem={({ item }) => <Notice notice={item} onChange={(n) => setNotices((prev) => prev.map((x) => (x.action.id === n.action.id ? n : x)))} />}
    />
  );
}

function Notice({ notice, onChange }: { notice: ModerationNotice; onChange: (n: ModerationNotice) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    try {
      onChange(await api.appeal(notice.action.id, text.trim()));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t(`action_${notice.action.action}`)} · {timeAgo(notice.action.createdAt, lang)}</Text>
      <Text style={styles.reason}>{notice.action.reason}</Text>
      {notice.appeal ? (
        <Text style={styles.meta}>{t(`appealStatus_${notice.appeal.status}`)}{notice.appeal.decisionReason ? ` · ${notice.appeal.decisionReason}` : ""}</Text>
      ) : null}
      {notice.canAppeal && !open ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}><Text style={styles.link}>{t("appeal")}</Text></Pressable>
      ) : null}
      {open ? (
        <>
          <TextInput accessibilityLabel={t("appealText")} value={text} onChangeText={setText} multiline maxLength={1000} placeholder={t("appealText")} placeholderTextColor={colors.textMuted} style={styles.input} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!validReason(text)} style={[styles.button, !validReason(text) && styles.disabled]} onPress={() => void send()}>
            <Text style={styles.buttonText}>{t("appeal")}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  reason: { color: colors.text },
  meta: { color: colors.textMuted, fontSize: 13 },
  link: { color: colors.accent, fontWeight: "600", marginTop: space.xs },
  input: { color: colors.text, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md, minHeight: 70, textAlignVertical: "top" },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.sm, alignItems: "center" },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "600" },
  error: { color: colors.accent, fontSize: 12 },
});
