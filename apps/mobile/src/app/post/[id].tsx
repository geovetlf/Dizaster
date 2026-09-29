import type { CommentView } from "@dizaster/contracts";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { lang, t } from "../../lib/i18n";
import { timeAgo } from "../../lib/ui/format";
import { colors, radius, space } from "../../theme";

/** Comentarios de una publicación. También es destino de enlaces dizaster://post/<id>. */
export default function PostCommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [comments, setComments] = useState<CommentView[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) api.comments(id).then((r) => setComments(r.comments)).catch(() => setError(t("loadError")));
  }, [id]);

  async function send() {
    if (!id || !text.trim()) return;
    setBusy(true);
    try {
      const c = await api.addComment(id, text.trim());
      setComments((prev) => [...prev, c]);
      setText("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.comment}>
            <Text style={styles.author}>{item.author.displayName} <Text style={styles.time}>· {timeAgo(item.createdAt, lang)}</Text></Text>
            <Text style={styles.text}>{item.text}</Text>
          </View>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput value={text} onChangeText={setText} maxLength={1000} multiline placeholder={t("writeComment")} placeholderTextColor={colors.textMuted} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy || !text.trim()} style={[styles.send, (busy || !text.trim()) && styles.disabled]} onPress={() => void send()}>
          <Text style={styles.sendText}>{t("publish")}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space.lg },
  comment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  author: { color: colors.text, fontWeight: "700" },
  time: { color: colors.textMuted, fontWeight: "400" },
  text: { color: colors.text, marginTop: 4 },
  error: { color: colors.accent, paddingHorizontal: space.lg },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, maxHeight: 120 },
  send: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12 },
  disabled: { opacity: 0.5 },
  sendText: { color: colors.white, fontWeight: "600" },
});
