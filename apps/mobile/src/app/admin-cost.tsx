import type { BudgetView, CostDashboard } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { parseUsd } from "../lib/admin/admin-tools";
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
  const [editing, setEditing] = useState<string | null>(null);

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
            <View key={b.key}>
              <Pressable accessibilityRole="button" style={styles.row} onPress={() => setEditing(editing === b.key ? null : b.key)}>
                <View style={[styles.dot, { backgroundColor: TONE[budgetTone(b.percent)] }]} />
                <Text style={styles.rowLabel}>{b.key} · {b.period === "DAILY" ? "24 h" : t("costMonth")}</Text>
                <Text style={styles.amount}>{usd(b.spentUsd)} / {usd(b.limitUsd)}</Text>
              </Pressable>
              {editing === b.key ? <BudgetEditor budget={b} onSaved={() => { setEditing(null); void load(days); }} /> : null}
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

/**
 * Cambiar un tope (ADR 0098). Subirlo de 0 autoriza gasto real: por eso pide confirmación y la decisión queda
 * registrada en el servidor con quién la tomó.
 */
function BudgetEditor({ budget, onSaved }: { budget: BudgetView; onSaved: () => void }) {
  const [text, setText] = useState(String(budget.limitUsd));
  const [period, setPeriod] = useState(budget.period);
  const [error, setError] = useState<string | null>(null);
  const value = parseUsd(text);
  function save() {
    if (value === null) return;
    Alert.alert(budget.key, `${t("budgetConfirm")} ${formatUsd(value, lang) ?? value}`, [
      { text: t("cancel"), style: "cancel" },
      { text: t("apply"), onPress: () => void api.setBudget(budget.key, period, value).then(onSaved).catch((e: Error) => setError(e.message)) },
    ]);
  }
  return (
    <View style={styles.editor}>
      <View style={styles.ranges}>
        {(["DAILY", "MONTHLY"] as const).map((p) => (
          <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: p === period }} style={[styles.range, p === period && styles.rangeOn]} onPress={() => setPeriod(p)}>
            <Text style={styles.rangeText}>{p === "DAILY" ? "24 h" : t("costMonth")}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="USD" placeholderTextColor={colors.textMuted} style={styles.input} />
      {error ? <Text style={styles.note}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={value === null} style={[styles.save, value === null && styles.disabled]} onPress={save}>
        <Text style={styles.rangeText}>{t("apply")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm, gap: space.sm },
  input: { color: colors.text, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md },
  save: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.sm, alignItems: "center" },
  disabled: { opacity: 0.4 },
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
