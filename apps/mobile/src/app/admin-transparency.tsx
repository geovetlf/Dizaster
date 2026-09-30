import type { TransparencyReport } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { formatCount, formatHours, sortedActions, sortedCounts, transparencyText, type TransparencyLabels } from "../lib/admin/transparency-format";
import { api } from "../lib/api";
import { t, tf, type MessageKey } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const PERIODS = [30, 90, 365] as const;
const known = (key: string, fallback: string) => {
  const v = t(key as MessageKey);
  return v === undefined ? fallback : v;
};

function labels(): TransparencyLabels {
  return {
    title: t("adminTransparency"), period: t("trPeriod"), flags: t("trFlags"), cases: t("trCases"), opened: t("trOpened"),
    resolved: t("trResolved"), dismissed: t("trDismissed"), median: t("trMedian"), actions: t("trActions"),
    reversals: t("trReversals"), appeals: t("trAppeals"), received: t("trReceived"), upheld: t("trUpheld"),
    reversed: t("trReversed"), open: t("trOpen"), authority: t("trAuthority"), note: t("trHint"),
    reason: (k) => known(`reason_${k}`, k), action: (k) => known(`action_${k}`, k),
    actor: (k) => (k === "RULE" ? t("trActorRule") : t("trActorModerator")),
    target: (k) => known(`trTarget_${k}`, k), authorityType: (k) => known(`authType_${k}`, k),
  };
}

/**
 * Informe de transparencia (ADR 0135, 0151). Solo administración. Muestra las cifras agregadas del servidor tal cual
 * (los 1–4 llegan como "<5") y permite compartir el texto para publicarlo.
 */
export default function AdminTransparencyScreen() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const [report, setReport] = useState<TransparencyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    api.transparency(days).then((r) => { setReport(r); setError(null); }).catch((e: Error) => setError(e.message));
  }, [days]));

  const l = labels();
  const row = (label: string, value: string, key?: string) => (
    <View key={key ?? label} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.chips}>
        {PERIODS.map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: d === days }}
            style={[styles.chip, d === days && styles.chipOn]} onPress={() => setDays(d)}>
            <Text style={styles.chipText}>{tf("trDays", { n: d })}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={error ? styles.error : styles.meta}>{error ?? l.note}</Text>
      {report ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{l.flags}: {formatCount(report.flags.total)}</Text>
            {sortedCounts(report.flags.byReason).map(([k, v]) => row(l.reason(k), String(v), k))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{l.cases}</Text>
            {row(l.opened, formatCount(report.cases.opened))}
            {row(l.resolved, formatCount(report.cases.resolved))}
            {row(l.dismissed, formatCount(report.cases.dismissed))}
            {row(l.median, formatHours(report.cases.medianHoursToClose))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{l.actions}</Text>
            {sortedActions(report.actions).map((a) =>
              row(`${l.action(a.action)} · ${l.target(a.targetType)} · ${l.actor(a.actor)}`, String(a.count), `${a.action}-${a.targetType}-${a.actor}`))}
            {row(l.reversals, formatCount(report.reversals))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{l.appeals}</Text>
            {row(l.received, formatCount(report.appeals.received))}
            {row(l.upheld, formatCount(report.appeals.upheld))}
            {row(l.reversed, formatCount(report.appeals.reversed))}
            {row(l.open, formatCount(report.appeals.open))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{l.authority}: {formatCount(report.authorityRequests.received)}</Text>
            {sortedCounts(report.authorityRequests.byType).map(([k, v]) => row(l.authorityType(k), String(v), k))}
          </View>
          <Pressable accessibilityRole="button" style={styles.share}
            onPress={() => { Share.share({ message: transparencyText(report, l) }).catch(() => undefined); }}>
            <Text style={styles.shareText}>{t("trShare")}</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  chips: { flexDirection: "row", gap: space.sm },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  label: { color: colors.textMuted, flex: 1 },
  value: { color: colors.text, fontVariant: ["tabular-nums"] },
  meta: { color: colors.textMuted },
  error: { color: colors.accentText },
  share: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, marginTop: space.sm },
  shareText: { color: colors.white, fontWeight: "700" },
});
