import type { EventStatus, EventSummary, ModeratorEventDetail, NearbyEvent, VerificationView } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../../lib/api";
import { lang, t, type MessageKey } from "../../../lib/i18n";
import { canSetNegative, canSplit, duplicateCandidates, raisableSensitivities, toggle } from "../../../lib/moderation/event-tools";
import { validReason } from "../../../lib/moderation/logic";
import { distanceLabel, eventTitle, timeAgo } from "../../../lib/ui/format";
import { colors, radius, space } from "../../../theme";
import { ErrorText } from "../../../components/error-text";

const STATUSES: EventStatus[] = ["ACTIVE", "MONITORING", "RESOLVED", "ARCHIVED"];
const NEGATIVE = ["NONE", "DISPUTED", "FALSE"] as const;
const TIER: Record<string, MessageKey> = { CITIZEN: "tierCitizen", EXTERNAL: "tierExternal", OFFICIAL: "tierOfficial" };

/**
 * Herramientas de moderación sobre un EVENT (ADR 0034): fusionar duplicados cercanos en él, revertir fusiones y
 * separar evidencias a un evento nuevo, y cambiar su ciclo de vida (ADR 0053). Todo exige motivo y queda registrado; nada muestra quién reportó.
 */
export default function EventToolsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [detail, setDetail] = useState<ModeratorEventDetail | null>(null);
  const [verification, setVerification] = useState<VerificationView | null>(null);
  const [nearby, setNearby] = useState<NearbyEvent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [ev, d, v] = await Promise.all([api.event(id), api.moderatorEvent(id), api.verification(id)]);
      setEvent(ev);
      setDetail(d);
      setVerification(v);
      setSelected(new Set());
      const near = await api.nearby(ev.point.lat, ev.point.lng, ev.categoryCode);
      setNearby(duplicateCandidates(near.events, id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const confirm = (message: string, action: () => Promise<unknown>) =>
    Alert.alert(t("eventTools"), message, [
      { text: t("cancel"), style: "cancel" },
      { text: t("apply"), onPress: () => void run(action) },
    ]);

  if (!detail || !event) return <View style={styles.container}>{error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}</View>;
  const ok = validReason(reason) && !busy;
  const merged = detail.mergedIntoId !== null;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/event/${event.id}`)}>
        <Text style={styles.title}>{eventTitle(event, lang)}</Text>
      </Pressable>
      {merged ? <Text style={styles.meta}>{t("mergedInto")}</Text> : null}

      <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} multiline maxLength={1000} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
      {error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}

      {/* Notas internas (ADR 0147): solo moderación las ve; nunca salen en la línea de tiempo pública. */}
      <Text style={styles.section}>{t("moderatorNotes")}</Text>
      <TextInput accessibilityLabel={t("moderatorNoteHint")} value={note} onChangeText={setNote} multiline maxLength={2000} placeholder={t("moderatorNoteHint")} placeholderTextColor={colors.textMuted} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: note.trim().length < 3 || busy }} disabled={note.trim().length < 3 || busy}
        style={[styles.button, (note.trim().length < 3 || busy) && styles.disabled]}
        onPress={() => void run(async () => { await api.addModeratorNote(event.id, note.trim()); setNote(""); })}>
        <Text style={styles.buttonText}>{t("authorityAddNote")}</Text>
      </Pressable>
      {detail.notes.map((n) => (
        <Text key={n.id} style={styles.meta}>{timeAgo(n.at, lang)} · {n.text}</Text>
      ))}

      {!merged ? (
        <>
          <Text style={styles.section}>{t("lifecycleSection")}</Text>
          <View style={styles.chips}>
            {STATUSES.map((s) => {
              const current = detail.status === s;
              return (
                <Pressable key={s} accessibilityRole="button" accessibilityState={{ selected: current, disabled: current || !ok }} disabled={current || !ok}
                  style={[styles.button, current && styles.current, !current && !ok && styles.disabled]}
                  onPress={() => confirm(t("confirmStatus"), () => api.setEventStatus(event.id, s, reason.trim()))}>
                  <Text style={styles.buttonText}>{t(`st_${s}`)}</Text>
                </Pressable>
              );
            })}
          </View>
          {detail.statusChanges.map((c) => (
            <Text key={c.at} style={styles.meta}>{timeAgo(c.at, lang)} · {t(`st_${c.from}`)} → {t(`st_${c.to}`)} · {c.reason}</Text>
          ))}

          <Text style={styles.section}>
            {t("severitySection")}: {detail.severity}/5{detail.severityOverride !== null ? ` · ${t("severityCorrected")}` : ""}
          </Text>
          <View style={styles.chips}>
            {([null, 1, 2, 3, 4, 5] as const).map((v) => {
              const current = detail.severityOverride === v;
              return (
                <Pressable key={v ?? "auto"} accessibilityRole="button" accessibilityState={{ selected: current, disabled: current || !ok }} disabled={current || !ok}
                  style={[styles.button, current && styles.current, !current && !ok && styles.disabled]}
                  onPress={() => confirm(t("confirmSeverity"), () => api.setEventSeverity(event.id, v, reason.trim()))}>
                  <Text style={styles.buttonText}>{v === null ? t("severityAuto") : String(v)}</Text>
                </Pressable>
              );
            })}
          </View>
          {detail.severityChanges.map((c) => (
            <Text key={c.at} style={styles.meta}>{timeAgo(c.at, lang)} · {c.from} → {c.to} · {c.reason}</Text>
          ))}

          <Text style={styles.section}>{t("sensitivitySection")}: {t(`sens_${detail.sensitivity}`)}</Text>
          <Text style={styles.meta}>{t("sensitivityHint")}</Text>
          <View style={styles.chips}>
            {raisableSensitivities(detail.sensitivity).map((v) => (
              <Pressable key={v} accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok}
                style={[styles.button, !ok && styles.disabled]}
                onPress={() => confirm(t("confirmSensitivity"), () => api.raiseEventSensitivity(event.id, v, reason.trim()))}>
                <Text style={styles.buttonText}>{t(`sens_${v}`)}</Text>
              </Pressable>
            ))}
          </View>
          {detail.sensitivityChanges.map((c) => (
            <Text key={c.at} style={styles.meta}>{timeAgo(c.at, lang)} · {t(`sens_${c.from}`)} → {t(`sens_${c.to}`)} · {c.reason}</Text>
          ))}

          {verification ? (
            <>
              <Text style={styles.section}>{t("negativeSection")}</Text>
              <Text style={styles.meta}>{t("negativeHint")}</Text>
              <View style={styles.chips}>
                {NEGATIVE.map((n) => {
                  const current = verification.negativeState === n;
                  const enabled = ok && canSetNegative(n, verification, selected.size);
                  return (
                    <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: current, disabled: !enabled }} disabled={!enabled}
                      style={[styles.button, current && styles.current, !current && !enabled && styles.disabled]}
                      onPress={() => confirm(t("confirmNegative"), () => api.setNegativeState(event.id, n, reason.trim(), n === "FALSE" ? [...selected] : []))}>
                      <Text style={styles.buttonText}>{t(`neg_${n}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <Text style={styles.section}>{t("possibleDuplicates")}</Text>
          {nearby.length === 0 ? <Text style={styles.meta}>{t("noDuplicates")}</Text> : null}
          {nearby.map((n) => (
            <View key={n.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{eventTitle(n, lang)}</Text>
                <Text style={styles.meta}>{distanceLabel(n.distanceBucket, lang)} · {n.reportCount} · {timeAgo(n.lastActivityAt, lang)}</Text>
              </View>
              <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, !ok && styles.disabled]}
                onPress={() => confirm(t("confirmMerge"), () => api.mergeEvents(event.id, [n.id], reason.trim()))}>
                <Text style={styles.buttonText}>{t("mergeHere")}</Text>
              </Pressable>
            </View>
          ))}

          <Text style={styles.section}>{t("evidenceSection")}</Text>
          {detail.evidence.map((e) => {
            const on = selected.has(e.id);
            return (
              <Pressable key={e.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.row, on && styles.selected]}
                onPress={() => setSelected((s) => toggle(s, e.id))}>
                <Text style={styles.check}>{on ? "☑" : "☐"}</Text>
                <Text style={styles.rowText}>
                  {t(TIER[e.trustTier] ?? "tierCitizen")}{e.assertion === "NOT_OCCURRING" ? ` · ${t("counterReport")}` : ""}
                  {e.presenceBand ? ` · ${e.presenceBand}` : ""} · {timeAgo(e.observedAt, lang)}
                </Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" disabled={!ok || !canSplit(selected, detail.evidence)}
            style={[styles.button, styles.wide, (!ok || !canSplit(selected, detail.evidence)) && styles.disabled]}
            onPress={() => confirm(t("confirmSplit"), async () => {
              const { eventId } = await api.splitEvent(event.id, [...selected], reason.trim());
              router.push(`/event/${eventId}`);
            })}>
            <Text style={styles.buttonText}>{t("splitSelected")}</Text>
          </Pressable>
        </>
      ) : null}

      {detail.merges.length ? <Text style={styles.section}>{t("mergesSection")}</Text> : null}
      {detail.merges.map((m) => (
        <View key={m.id} style={styles.row}>
          <Text style={styles.rowText}>
            {timeAgo(m.at, lang)} · {m.movedEvidence} · {m.reason}{m.revertedAt ? ` · ${t("reverted")}` : ""}
          </Text>
          {!m.revertedAt ? (
            <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, !ok && styles.disabled]}
              onPress={() => void run(() => api.revertMerge(m.id, reason.trim()))}>
              <Text style={styles.buttonText}>{t("revertMerge")}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  title: { color: colors.link, fontSize: 18, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  section: { color: colors.text, fontWeight: "700", marginTop: space.lg },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, minHeight: 70, textAlignVertical: "top" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  selected: { borderWidth: 1, borderColor: colors.link },
  rowText: { flex: 1, color: colors.text },
  rowTitle: { color: colors.text, fontWeight: "600" },
  check: { color: colors.text, fontSize: 18 },
  button: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  current: { backgroundColor: colors.link },
  wide: { alignSelf: "flex-start", marginTop: space.sm },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontWeight: "600" },
  error: { color: colors.accentText, padding: space.sm },
});
