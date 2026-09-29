import type { CostDashboard } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "../lib/api";
import { barHeights, budgetTone, formatBytes, formatUnits, formatUsd, moduleRows } from "../lib/admin/cost-format";
import { lang, t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const RANGES = [7, 30, 90] as const;
const TONE = { ok: "#22C55E", warn: "#FACC15", high: "#F97316", over: colors.accent } as const;

/** Tablero de costo (solo administración): el mismo que GET /v1/admin/cost, sin panel web (V1 es solo app). */
export default function AdminCostScreen() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [d, setD] = useState<CostDashboard | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async (n: number) => {
    try {
      setD(await api.costDashboard(n));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(days); }, [load, days]));

  async function toggle(feature: string, killed: boolean) {
    if (!d) return;
    setD({ ...d, killSwitches: d.killSwitches.map((k) => (k.feature === feature ? { ...k, killed } : k)) });
    await api.setKillSwitch(feature, killed).catch(() => undefined);
    void load(days);
  }

  const usd = (n: number | null) => formatUsd(n, lang) ?? "—";
  const heights = d ? barHeights(d.daily.map((x) => x.requests)) : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load(days)} tintColor={colors.textMuted} />}>
      <View style={styles.ranges}>
        {RANGES.map((r) => (
          <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: r === days }} style={[styles.range, r === days && styles.rangeOn]} onPress={() => setDays(r)}>
            <Text style={styles.rangeText}>{r} {t("days")}</Text>
          </Pressable>
        ))}
      </View>
      {!d ? <Text style={styles.note}>{error ? t("loadError") : ""}</Text> : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>{t("costTotal")}</Text>
            <Text style={styles.big}>{usd(d.estimatedUsd.total)}</Text>
            <Text style={styles.sub}>{t("costPer1000")}: {usd(d.costPer1000ActiveUsers)} · {t("activeUsers")}: {d.activeUsers}</Text>
            <Text style={styles.sub}>
              {t("costVariable")} {usd(d.estimatedUsd.variable)} · {t("costStorage")} {usd(d.estimatedUsd.storage)} · {t("costFixed")} {d.estimatedUsd.fixed === null ? t("costFixedPending") : usd(d.estimatedUsd.fixed)}
            </Text>
            <Text style={styles.sub}>DB {formatBytes(d.gauges.databaseBytes)} · Media {formatBytes(d.gauges.mediaStoredBytes)}</Text>
          </View>

          <View style={styles.bars} accessibilityLabel="requests">
            {heights.map((h, i) => <View key={d.daily[i]!.day} style={[styles.bar, { height: 4 + h * 56 }]} />)}
          </View>

          <Text style={styles.section}>{t("costModules")}</Text>
          {moduleRows(d).map((m) => (
            <View key={m.module} style={styles.row}>
              <Text style={styles.rowLabel}>{m.module}</Text>
              <Text style={styles.value}>{formatUnits(m.units)}</Text>
              <Text style={styles.amount}>{usd(m.usd)}</Text>
            </View>
          ))}

          <Text style={styles.section}>{t("costBudgets")}</Text>
          {d.budgets.map((b) => (
            <View key={b.key} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: TONE[budgetTone(b.percent)] }]} />
              <Text style={styles.rowLabel}>{b.key} · {b.period === "DAILY" ? "24 h" : t("costMonth")}</Text>
              <Text style={styles.amount}>{usd(b.spentUsd)} / {usd(b.limitUsd)}</Text>
            </View>
          ))}

          <Text style={styles.section}>{t("costKillSwitches")}</Text>
          {d.killSwitches.map((k) => (
            <View key={k.feature} style={styles.row}>
              <View style={styles.rowLabel}>
                <Text style={styles.rowText}>{k.feature}</Text>
                {k.reason ? <Text style={styles.value}>{k.reason}</Text> : null}
              </View>
              <Switch value={!k.killed} onValueChange={(on) => void toggle(k.feature, !on)} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
          ))}
          <Text style={styles.note}>{t("costEstimateNote")} ({d.pricesVersion})</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  ranges: { flexDirection: "row", gap: space.sm, marginBottom: space.md },
  range: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  rangeOn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  rangeText: { color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  label: { color: colors.textMuted },
  big: { color: colors.text, fontSize: 30, fontWeight: "800" },
  sub: { color: colors.textMuted, fontSize: 13 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 64, marginVertical: space.lg },
  bar: { flex: 1, backgroundColor: colors.accent, borderRadius: 2, opacity: 0.8 },
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: space.lg, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.xs },
  rowLabel: { flex: 1, color: colors.text },
  rowText: { color: colors.text },
  value: { color: colors.textMuted, fontSize: 13 },
  amount: { color: colors.text, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.lg },
});
