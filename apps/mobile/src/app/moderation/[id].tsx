import type { CaseDetail, ModerationActionType, PresenceReview } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { lang, t } from "../../lib/i18n";
import { actionsFor, isSevere, presenceLines, reasonSummary, validReason } from "../../lib/moderation/logic";
import { timeAgo } from "../../lib/ui/format";
import { colors, radius, space } from "../../theme";

/** Un caso: qué se denunció, por qué, qué se hizo, y las acciones posibles (con motivo obligatorio). */
export default function CaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceReview | null>(null);

  // Al abrir el caso se toma (ADR 0134); si otra persona lo tiene, se ve igual pero sin poder actuar. Al salir se suelta.
  useEffect(() => {
    if (!id) return;
    let claimed = false;
    api.moderationClaim(id)
      .then((d) => { claimed = true; setC(d); })
      .catch((e: Error) => {
        setError(e.message);
        api.moderationCase(id).then(setC).catch(() => undefined);
      });
    return () => { if (claimed) void api.moderationRelease(id).catch(() => undefined); };
  }, [id]);

  async function apply(action: ModerationActionType) {
    if (!c) return;
    try {
      setC(await api.moderationAct(c.id, action, reason.trim()));
      setReason("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Ver la evidencia de presencia (ADR 0089): usa el mismo motivo escrito y queda en auditoría. */
  async function viewPresence() {
    if (!c) return;
    try {
      setPresence(await api.moderationPresence(c.target.id, reason.trim(), c.id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function confirm(action: ModerationActionType) {
    if (!isSevere(action)) return void apply(action);
    Alert.alert(t(`action_${action}`), t("confirmSevere"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("apply"), style: "destructive", onPress: () => void apply(action) },
    ]);
  }

  if (!c) return <View style={styles.container}>{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
  const ok = validReason(reason);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kind}>{c.target.type} · {c.target.state} · {c.status}</Text>
      <Text style={styles.author}>{c.target.authorHandle ? `@${c.target.authorHandle}` : t("pseudonymousAuthor")}</Text>
      <Text style={styles.text}>{c.target.text ?? "—"}</Text>
      {c.target.media?.length ? (
        <View style={styles.media}>
          {c.target.media.map((m) => (
            <Image key={m.id} source={{ uri: m.thumbUrl ?? m.url }} style={styles.thumb} accessibilityIgnoresInvertColors />
          ))}
        </View>
      ) : null}
      <Text style={styles.meta}>{reasonSummary(c.reasons, (r) => t(`reason_${r}`))}</Text>
      {c.target.type === "EVENT" ? (
        <Pressable accessibilityRole="button" style={[styles.action, styles.tools]} onPress={() => router.push(`/moderation/event/${c.target.id}`)}>
          <Text style={styles.actionText}>{t("eventTools")}</Text>
        </Pressable>
      ) : null}
      {c.notes.map((n, i) => <Text key={i} style={styles.note}>“{n.note}” · {t(`reason_${n.reason}`)}</Text>)}

      {c.actions.length ? <Text style={styles.section}>{t("timeline")}</Text> : null}
      {c.actions.map((a) => (
        <Text key={a.id} style={styles.meta}>
          {timeAgo(a.createdAt, lang)} · {t(`action_${a.action}`)}{a.actor === "RULE" ? ` (${t("ruleActor")})` : ""} · {a.reason}
        </Text>
      ))}

      <TextInput value={reason} onChangeText={setReason} multiline maxLength={1000} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {presence ? presenceLines(presence, t).map((l) => <Text key={l} style={styles.meta}>{l}</Text>) : null}
      <View style={styles.actions}>
        {c.target.type === "POST" && !presence ? (
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.action, !ok && styles.disabled]} onPress={() => void viewPresence()}>
            <Text style={styles.actionText}>{t("viewPresence")}</Text>
          </Pressable>
        ) : null}
        {actionsFor(c.target.type).map((a) => (
          <Pressable key={a} accessibilityRole="button" disabled={!ok} style={[styles.action, isSevere(a) && styles.severe, !ok && styles.disabled]} onPress={() => confirm(a)}>
            <Text style={styles.actionText}>{t(`action_${a}`)}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xs },
  kind: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  author: { color: colors.text, fontWeight: "700", marginTop: space.sm },
  text: { color: colors.text, fontSize: 16, marginVertical: space.sm },
  meta: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.text, fontStyle: "italic" },
  section: { color: colors.text, fontWeight: "700", marginTop: space.lg },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, minHeight: 70, marginTop: space.lg, textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  action: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  severe: { backgroundColor: colors.accent },
  disabled: { opacity: 0.4 },
  tools: { alignSelf: "flex-start", marginTop: space.sm },
  media: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginVertical: space.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  actionText: { color: colors.white, fontWeight: "600" },
  error: { color: colors.accent, padding: space.sm },
});
