import { POST_TEXT_MAX, extractMentions, extractTags } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MediaAttachments } from "../components/media-attachments";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { discardLocal } from "../lib/media/capture";
import type { LocalMedia } from "../lib/media/local-media";
import { uploadMedia } from "../lib/media/upload";
import { composeProblem } from "../lib/social/compose";
import { colors, radius, space } from "../theme";

/**
 * Publicar sin reporte (D-03): opinión, apoyo o noticia, desde cualquier lugar. Si se abre desde un evento lo
 * menciona, sin sumar al pin ni a la verificación. No usa la ubicación. Igual en Android e iOS.
 */
export default function ComposeScreen() {
  const params = useLocalSearchParams<{ eventId?: string; text?: string }>();
  const [text, setText] = useState(params.text ?? "");
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [pseudonymous, setPseudonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const tags = extractTags(text);
  const mentions = extractMentions(text);
  const problem = composeProblem(text, media);

  async function publish() {
    if (problem) return setStatus(t(problem));
    setBusy(true);
    setStatus(media.length ? t("uploadingMedia") : null);
    try {
      const mediaIds: string[] = [];
      for (const m of media) {
        const r = await uploadMedia(m);
        if (!r.ok) throw new Error(r.error);
        mediaIds.push(r.mediaId);
      }
      await api.createPost({ text: text.trim(), mediaIds, anonymityMode: pseudonymous ? "PSEUDONYMOUS" : "PUBLIC", ...(params.eventId ? { eventId: params.eventId } : {}) });
      for (const m of media) discardLocal(m);
      router.back();
    } catch (e) {
      setStatus((e as Error).message || t("publishError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {params.eventId ? <Text style={styles.note}>{t("postAboutEvent")}</Text> : null}
      <TextInput
        style={styles.input}
        multiline
        autoFocus
        maxLength={POST_TEXT_MAX}
        value={text}
        onChangeText={setText}
        placeholder={t("composePlaceholder")}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t("newPost")}
      />
      <Text style={styles.counter}>{text.length}/{POST_TEXT_MAX}</Text>
      {tags.length || mentions.length ? (
        <Text style={styles.note}>{[...tags.map((x) => `#${x.display}`), ...mentions.map((m) => `@${m}`)].join("  ")}</Text>
      ) : null}
      <MediaAttachments items={media} onChange={setMedia} />
      <View style={styles.switchRow}>
        <Text style={styles.rowText}>{t("pseudonymous")}</Text>
        <Switch value={pseudonymous} onValueChange={setPseudonymous} />
      </View>
      <Text style={styles.note}>{t("composeNote")}</Text>
      <Pressable accessibilityRole="button" disabled={busy || problem !== null} style={[styles.send, (busy || problem !== null) && styles.disabled]} onPress={() => void publish()}>
        <Text style={styles.sendText}>{busy ? t("sending") : t("publish")}</Text>
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  input: { minHeight: 140, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, fontSize: 16, textAlignVertical: "top" },
  counter: { color: colors.textMuted, fontSize: 12, alignSelf: "flex-end" },
  note: { color: colors.textMuted, fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.sm },
  rowText: { color: colors.text, fontSize: 15 },
  send: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center", marginTop: space.md },
  disabled: { opacity: 0.5 },
  sendText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  status: { color: colors.textMuted, marginTop: space.sm },
});
