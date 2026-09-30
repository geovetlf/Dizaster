import { can, type AppealView, type CaseSummary, type DuplicateCandidateView } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { useRoles } from "../../lib/auth/roles";
import { lang, t } from "../../lib/i18n";
import { reasonSummary, validReason } from "../../lib/moderation/logic";
import { eventTitle, timeAgo } from "../../lib/ui/format";
import { colors, radius, space } from "../../theme";

/** Herramientas de moderación dentro de la app (V1 sin panel web): cola priorizada, apelaciones y posibles duplicados (ADR 0096). */
export default function ModerationScreen() {
  const [tab, setTab] = useState<"queue" | "appeals" | "duplicates">("queue");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<AppealView[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidateView[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Cada rol ve sus pestañas (ADR 0101): verificación solo duplicados; moderación, todo.
  const roles = useRoles();
  const moderates = can(roles, "content.moderate");
  const verifies = can(roles, "event.verify");
  const tabs = [...(moderates ? (["queue", "appeals"] as const) : []), ...(verifies ? (["duplicates"] as const) : [])];
  const shown = tabs.includes(tab) ? tab : tabs[0] ?? "queue";

  const load = useCallback(async () => {
    const [q, a, d] = await Promise.all([
      moderates ? api.moderationQueue().catch(() => null) : null,
      moderates ? api.appeals().catch(() => null) : null,
      verifies ? api.duplicateQueue().catch(() => null) : null,
    ]);
    if (q) { setCases(q.cases); setCursor(q.nextCursor); }
    if (a) setAppeals(a.appeals);
    if (d) setDuplicates(d.candidates);
    setLoaded(true);
  }, [moderates, verifies]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function more() {
    if (!cursor) return;
    const q = await api.moderationQueue(cursor).catch(() => null);
    if (q) { setCases((prev) => [...prev, ...q.cases]); setCursor(q.nextCursor); }
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {tabs.map((k) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: shown === k }} style={[styles.tab, shown === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={styles.tabText}>
              {k === "queue" ? `${t("moderationQueue")} (${cases.length})` : k === "appeals" ? `${t("moderationAppeals")} (${appeals.length})` : `${t("duplicatesTab")} (${duplicates.length})`}
            </Text>
          </Pressable>
        ))}
      </View>
      {shown === "queue" ? (
        <FlatList
          data={cases}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.textMuted} />}
          onEndReached={() => void more()}
          ListEmptyComponent={loaded ? <Text style={styles.empty}>{t("noCases")}</Text> : null}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/moderation/${item.id}`)}>
              <View style={styles.priority}><Text style={styles.priorityText}>{Math.round(item.priority)}</Text></View>
              <View style={styles.body}>
                <Text style={styles.kind}>{item.target.type} · {item.target.state}</Text>
                <Text style={styles.text} numberOfLines={2}>{item.target.text ?? "—"}</Text>
                <Text style={styles.meta}>{reasonSummary(item.reasons, (r) => t(`reason_${r}`))} · {timeAgo(item.openedAt, lang)}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : shown === "duplicates" ? (
        <FlatList
          data={duplicates}
          keyExtractor={(d) => d.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.textMuted} />}
          ListEmptyComponent={loaded ? <Text style={styles.empty}>{t("noDuplicatePairs")}</Text> : null}
          renderItem={({ item }) => <DuplicateRow candidate={item} onDone={() => setDuplicates((prev) => prev.filter((d) => d.id !== item.id))} />}
        />
      ) : (
        <FlatList
          data={appeals}
          keyExtractor={(a) => a.id}
          ListEmptyComponent={loaded ? <Text style={styles.empty}>{t("noAppeals")}</Text> : null}
          renderItem={({ item }) => <AppealRow appeal={item} onDone={() => setAppeals((prev) => prev.filter((a) => a.id !== item.id))} />}
        />
      )}
    </View>
  );
}

/** Par de posibles duplicados (ADR 0076): unir uno en otro o descartar, siempre con motivo. */
function DuplicateRow({ candidate, onDone }: { candidate: DuplicateCandidateView; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [a, b] = candidate.events;
  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const ok = validReason(reason);
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.kind}>{t(`dupReason_${candidate.reason}`)} · {Math.round(candidate.score * 100)}% · {timeAgo(candidate.createdAt, lang)}</Text>
        {[a, b].map((e, i) => (
          <Pressable key={e.id} accessibilityRole="link" onPress={() => router.push(`/moderation/event/${e.id}`)}>
            <Text style={styles.text} numberOfLines={1}>{i + 1}. {eventTitle(e, lang)} · {e.reportCount} · {timeAgo(e.firstSeenAt, lang)}</Text>
          </Pressable>
        ))}
        <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, !ok && styles.disabled]} onPress={() => void act(() => api.mergeEvents(a.id, [b.id], reason.trim()))}>
            <Text style={styles.buttonText}>{t("mergeIntoFirst")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, !ok && styles.disabled]} onPress={() => void act(() => api.mergeEvents(b.id, [a.id], reason.trim()))}>
            <Text style={styles.buttonText}>{t("mergeIntoSecond")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, styles.primary, !ok && styles.disabled]} onPress={() => void act(() => api.dismissDuplicate(candidate.id, reason.trim()))}>
            <Text style={styles.buttonText}>{t("dismissDuplicate")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AppealRow({ appeal, onDone }: { appeal: AppealView; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "UPHOLD" | "REVERSE") {
    try {
      await api.decideAppeal(appeal.id, decision, reason.trim());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const ok = validReason(reason);
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.kind}>{t(`action_${appeal.action.action}`)} · {appeal.action.targetType}</Text>
        <Text style={styles.meta}>{appeal.action.reason}</Text>
        {appeal.target?.text ? <Text style={styles.text} numberOfLines={3}>{appeal.target.text}</Text> : null}
        <Text style={styles.appealText}>“{appeal.text}”</Text>
        <TextInput accessibilityLabel={t("appealDecisionReason")} value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("appealDecisionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, !ok && styles.disabled]} onPress={() => void decide("UPHOLD")}>
            <Text style={styles.buttonText}>{t("upholdAppeal")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!ok} style={[styles.button, styles.primary, !ok && styles.disabled]} onPress={() => void decide("REVERSE")}>
            <Text style={styles.buttonText}>{t("reverseAppeal")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: "row", gap: space.sm, padding: space.md },
  tab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  tabText: { color: colors.text },
  row: { flexDirection: "row", gap: space.md, padding: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  priority: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  priorityText: { color: colors.text, fontWeight: "800" },
  body: { flex: 1, gap: 2 },
  kind: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  text: { color: colors.text },
  meta: { color: colors.textMuted, fontSize: 12 },
  appealText: { color: colors.text, fontStyle: "italic", marginTop: space.xs },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.sm, marginTop: space.sm },
  buttons: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  button: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.sm, alignItems: "center" },
  primary: { backgroundColor: colors.accent },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "600" },
  error: { color: colors.accentText, fontSize: 12 },
  empty: { color: colors.textMuted, textAlign: "center", padding: space.xl },
});
