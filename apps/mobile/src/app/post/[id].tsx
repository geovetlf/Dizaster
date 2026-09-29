import type { CommentView, FeedPost } from "@dizaster/contracts";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { categoryName } from "../../components/feed-list";
import { Icon } from "../../components/icon";
import { PostCard } from "../../components/post-card";
import { api } from "../../lib/api";
import { lang, t } from "../../lib/i18n";
import { canBlock } from "../../lib/moderation/logic";
import { openContentMenu } from "../../lib/moderation/menu";
import { threadComments } from "../../lib/social/comments";
import { useMe } from "../../lib/social/me";
import { applyReaction } from "../../lib/social/reactions";
import { timeAgo } from "../../lib/ui/format";
import { colors, radius, space } from "../../theme";

/** Una publicación y sus comentarios. Destino de dizaster://post/<id> y https://<dominio>/p/<id> (ADR 0083). */
export default function PostCommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [comments, setComments] = useState<CommentView[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const me = useMe();
  const [post, setPost] = useState<FeedPost | null>(null);

  useEffect(() => {
    if (!id) return;
    api.post(id).then(setPost).catch(() => setPost(null));
    api.comments(id).then((r) => setComments(r.comments)).catch(() => setError(t("loadError")));
  }, [id]);

  async function send() {
    if (!id || !text.trim()) return;
    setBusy(true);
    try {
      const c = await api.addComment(id, text.trim(), replyTo?.id);
      setComments((prev) => [...prev, c]);
      setText("");
      setReplyTo(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(c: CommentView) {
    const on = !c.myReactions.includes("LIKE");
    const patch = (next: Pick<CommentView, "reactions" | "myReactions">) =>
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...next } : x)));
    patch(applyReaction(c, "LIKE", on));
    try {
      patch(await api.setCommentReaction(c.id, "LIKE", on));
    } catch {
      patch({ reactions: c.reactions, myReactions: c.myReactions });
    }
  }

  function confirmDelete(c: CommentView) {
    Alert.alert(t("deleteComment"), t("deleteCommentConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"), style: "destructive",
        onPress: () => void api.deleteComment(c.id).then(() => setComments((prev) => prev.filter((x) => x.id !== c.id))).catch((e: Error) => setError(e.message)),
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={threadComments(comments)}
        keyExtractor={(x) => x.comment.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={post ? <PostCard post={post} categoryName={categoryName} /> : null}
        renderItem={({ item: { comment: item, reply } }) => {
          const liked = item.myReactions.includes("LIKE");
          return (
            // Mantener pulsado: denunciar o bloquear (mismo gesto en iOS y Android).
            <Pressable
              accessibilityRole="text"
              accessibilityHint={t("options")}
              onLongPress={() => item.mine ? confirmDelete(item) : openContentMenu(
                { type: "COMMENT", id: item.id, blockHandle: canBlock({ pseudonymous: false, handle: item.author.handle }, me.handle) ? item.author.handle : null },
                () => setComments((prev) => prev.filter((c) => c.author.handle !== item.author.handle)),
              )}
              style={[styles.comment, reply && styles.reply]}
            >
              <Text style={styles.author}>{item.author.displayName} <Text style={styles.time}>· {timeAgo(item.createdAt, lang)}</Text></Text>
              <Text style={styles.text}>{item.text}</Text>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: liked }} hitSlop={8} onPress={() => void toggleLike(item)} style={styles.action}>
                  <Icon name={liked ? "heart" : "heart-outline"} size={16} color={liked ? colors.like : colors.textMuted} />
                  {item.reactions.LIKE ? <Text style={styles.time}>{item.reactions.LIKE}</Text> : null}
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setReplyTo(item)}>
                  <Text style={styles.link}>{t("replyAction")}</Text>
                </Pressable>
                {item.mine ? (
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(item)}>
                    <Text style={styles.link}>{t("delete")}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {replyTo ? (
        <Pressable accessibilityRole="button" onPress={() => setReplyTo(null)} style={styles.replying}>
          <Text style={styles.time}>{t("replyingTo")} {replyTo.author.displayName}  ✕</Text>
        </Pressable>
      ) : null}
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
  reply: { marginStart: space.xl },
  actions: { flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: space.sm },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { color: colors.textMuted, fontWeight: "600" },
  replying: { paddingHorizontal: space.lg, paddingTop: space.sm },
  error: { color: colors.accent, paddingHorizontal: space.lg },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, maxHeight: 120 },
  send: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12 },
  disabled: { opacity: 0.5 },
  sendText: { color: colors.white, fontWeight: "600" },
});
