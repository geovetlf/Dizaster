import type { AppealView, CaseSummary } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { lang, t } from "../../lib/i18n";
import { reasonSummary, validReason } from "../../lib/moderation/logic";
import { timeAgo } from "../../lib/ui/format";
import { colors, radius, space } from "../../theme";

/** Herramientas de moderación dentro de la app (V1 sin panel web): cola priorizada y apelaciones. */
export default function ModerationScreen() {
  const [tab, setTab] = useState<"queue" | "appeals">("queue");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<AppealView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [q, a] = await Promise.all([api.moderationQueue(), api.appeals()]).catch(() => [null, null] as const);
    if (q) { setCases(q.cases); setCursor(q.nextCursor); }
    if (a) setAppeals(a.appeals);
    setLoaded(true);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function more() {
    if (!cursor) return;
    const q = await api.moderationQueue(cursor).catch(() => null);
    if (q) { setCases((prev) => [...prev, ...q.cases]); setCursor(q.nextCursor); }
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["queue", "appeals"] as const).map((k) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={styles.tabText}>{k === "queue" ? `${t("moderationQueue")} (${cases.length})` : `${t("moderationAppeals")} (${appeals.length})`}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "queue" ? (
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
        <TextInput value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("appealDecisionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
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
  error: { color: colors.accent, fontSize: 12 },
  empty: { color: colors.textMuted, textAlign: "center", padding: space.xl },
});
