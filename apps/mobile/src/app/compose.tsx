import { POST_TEXT_MAX, detectPersonalData, extractMentions, extractTags, type BusinessView } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MediaAttachments } from "../components/media-attachments";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { discardLocal } from "../lib/media/capture";
import type { LocalMedia } from "../lib/media/local-media";
import { uploadMedia } from "../lib/media/upload";
import { composeProblem } from "../lib/social/compose";
import { colors, radius, space } from "../theme";
import { UpdateRequired, useUpdateRequirement } from "../components/update-required";

/**
 * Publicar sin reporte (D-03): opinión, apoyo o noticia, desde cualquier lugar. Si se abre desde un evento lo
 * menciona, sin sumar al pin ni a la verificación. No usa la ubicación. Igual en Android e iOS.
 */
export default function ComposeScreen() {
  const params = useLocalSearchParams<{ eventId?: string; text?: string; asBusiness?: string; shareOf?: string; official?: string }>();
  // Actualización oficial (ADR 0153): se abre desde el evento con la institución ya elegida.
  const official = params.official === "1" && !!params.eventId && !!params.asBusiness;
  // Compartir dentro de la app (ADR 0046): comentario opcional, sin fotos ni evento propios.
  const sharing = !!params.shareOf;
  const [text, setText] = useState(params.text ?? "");
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [pseudonymous, setPseudonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // "Publicar como": yo o uno de mis negocios. Un negocio nunca publica de forma seudónima.
  const [businesses, setBusinesses] = useState<BusinessView[]>([]);
  // Versión por debajo de la mínima (ADR 0164): no se envía; emergencias sigue a mano.
  const update = useUpdateRequirement();
  const [asBusiness, setAsBusiness] = useState<string | null>(params.asBusiness ?? null);
  useEffect(() => { api.myBusinesses().then((r) => setBusinesses(r.businesses)).catch(() => undefined); }, []);

  const tags = extractTags(text);
  const mentions = extractMentions(text);
  const problem = sharing ? null : composeProblem(text, media);

  async function publish() {
    if (problem) return setStatus(t(problem));
    setBusy(true);
    setStatus(media.length ? t("uploadingMedia") : null);
    try {
      if (params.shareOf) {
        const anonymityMode = pseudonymous && !asBusiness ? "PSEUDONYMOUS" : "PUBLIC";
        await api.sharePost(params.shareOf, { ...(text.trim() ? { text: text.trim() } : {}), anonymityMode, ...(asBusiness ? { asBusiness } : {}) });
        router.back();
        return;
      }
      const mediaIds: string[] = [];
      for (const m of media) {
        const r = await uploadMedia(m);
        if (!r.ok) throw new Error(r.error);
        mediaIds.push(r.mediaId);
      }
      await api.createPost({ text: text.trim(), mediaIds, anonymityMode: pseudonymous && !asBusiness ? "PSEUDONYMOUS" : "PUBLIC", ...(asBusiness ? { asBusiness } : {}), ...(params.eventId ? { eventId: params.eventId } : {}), ...(official ? { official: true } : {}) });
      for (const m of media) discardLocal(m);
      router.back();
    } catch (e) {
      setStatus((e as Error).message || t("publishError"));
    } finally {
      setBusy(false);
    }
  }

  if (update.required) return <UpdateRequired storeUrl={update.storeUrl} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {official ? <Text style={styles.note}>{t("officialUpdateNote")}</Text> : params.eventId ? <Text style={styles.note}>{t("postAboutEvent")}</Text> : null}
      {sharing ? <Text style={styles.note}>{t("sharingNote")}</Text> : null}
      <TextInput
        style={styles.input}
        multiline
        autoFocus
        maxLength={POST_TEXT_MAX}
        value={text}
        onChangeText={setText}
        placeholder={sharing ? t("sharePlaceholder") : t("composePlaceholder")}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t("newPost")}
      />
      <Text style={styles.counter}>{text.length}/{POST_TEXT_MAX}</Text>
      {detectPersonalData(text).length ? <Text style={styles.warn}>{t("personalDataWarning")}</Text> : null}
      {tags.length || mentions.length ? (
        <Text style={styles.note}>{[...tags.map((x) => `#${x.display}`), ...mentions.map((m) => `@${m}`)].join("  ")}</Text>
      ) : null}
      {sharing ? null : <MediaAttachments items={media} onChange={setMedia} />}
      {businesses.length > 0 && !official ? (
        <View style={styles.chips}>
          <Text style={styles.note}>{t("postAs")}</Text>
          {[null, ...businesses.map((b) => b.handle)].map((h) => (
            <Pressable key={h ?? "me"} accessibilityRole="button" accessibilityState={{ selected: asBusiness === h }} style={[styles.chip, asBusiness === h && styles.chipOn]} onPress={() => setAsBusiness(h)}>
              <Text style={styles.rowText}>{h ? businesses.find((b) => b.handle === h)!.name : t("postAsMe")}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {asBusiness ? null : (
        <View style={styles.switchRow}>
          <Text style={styles.rowText}>{t("pseudonymous")}</Text>
          <Switch value={pseudonymous} onValueChange={setPseudonymous} />
        </View>
      )}
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
  warn: { color: colors.like, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.sm },
  rowText: { color: colors.text, fontSize: 15 },
  send: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center", marginTop: space.md },
  disabled: { opacity: 0.5 },
  sendText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  status: { color: colors.textMuted, marginTop: space.sm },
});
