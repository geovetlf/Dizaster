import type { QualityReport } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { SLO_LABEL_KEY, formatObserved, formatRate, sloTone } from "../lib/admin/quality-format";
import { t, verificationLabel as vl } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const RANGES = [1, 7, 30] as const;
const TONE = { ok: "#22C55E", over: colors.accent, none: colors.border } as const;

/** Tablero de calidad (solo administración): el mismo que GET /v1/admin/quality. Solo cifras agregadas. */
export default function AdminQualityScreen() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [r, setR] = useState<QualityReport | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async (n: number) => {
    try {
      setR(await api.qualityReport(n));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(days); }, [load, days]));

  const v = (n: number | null, unit: "ms" | "s" | "h") => formatObserved(n, unit) ?? "—";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load(days)} tintColor={colors.textMuted} />}>
      <View style={styles.ranges}>
        {RANGES.map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: d === days }} style={[styles.range, d === days && styles.rangeOn]} onPress={() => setDays(d)}>
            <Text style={styles.rangeText}>{d} {t("days")}</Text>
          </Pressable>
        ))}
      </View>
      {!r ? <Text style={styles.note}>{error ? t("loadError") : ""}</Text> : (
        <>
          <Text style={styles.section}>{t("qualitySlos")}</Text>
          {r.slos.map((s) => (
            <View key={s.key} style={styles.row} accessibilityLabel={`${t(SLO_LABEL_KEY[s.key])}: ${s.ok === null ? t("sloNoData") : v(s.observed, s.unit)}`}>
              <View style={[styles.dot, { backgroundColor: TONE[sloTone(s)] }]} />
              <View style={styles.rowLabel}>
                <Text style={styles.rowText}>{t(SLO_LABEL_KEY[s.key])}</Text>
                <Text style={styles.value}>≤ {v(s.target, s.unit)}</Text>
              </View>
              <Text style={styles.amount}>{s.ok === null && s.observed === null ? t("sloNoData") : v(s.observed, s.unit)}</Text>
            </View>
          ))}

          <Block title="API" lines={[`${r.api.requests} ${t("qualityRequests")} · p50 ${v(r.api.p50Ms, "ms")} · p95 ${v(r.api.p95Ms, "ms")} · p99 ${v(r.api.p99Ms, "ms")}`]} />
          <Block title={t("qualityEvents")} lines={[`${r.events.created} ${t("qualityCreated")} · ${r.events.merged} ${t("qualityMerged")} (${formatRate(r.events.mergeRate)})`]} />
          <Block
            title={t("qualityVerification")}
            lines={[
              `${vl("COMMUNITY_CORROBORATED")}: ${r.verification.communityCorroborated}`,
              `${vl("EXTERNALLY_CORROBORATED")}: ${r.verification.externallyCorroborated}`,
              `${vl("OFFICIALLY_CONFIRMED")}: ${r.verification.officiallyConfirmed}`,
              `${vl("DISPUTED")}: ${r.verification.disputed} · ${vl("FALSE")}: ${r.verification.markedFalse}`,
              `${t("qualityToCorroborate")}: ${r.verification.medianMinutesToCorroboration === null ? "—" : `${r.verification.medianMinutesToCorroboration} min`}`,
            ]}
          />
          <Block
            title={t("qualityAlerts")}
            lines={[
              `${r.alerts.alerts} · ${r.alerts.critical} ${t("qualityCritical")}`,
              `${t("qualityPush")}: ${v(r.alerts.pushP50Seconds, "s")} / ${v(r.alerts.pushP95Seconds, "s")}`,
              Object.entries(r.alerts.notifications).map(([k, n]) => `${k} ${n}`).join(" · ") || "—",
            ]}
          />
          <Block
            title={t("qualityIngestion")}
            lines={[`${r.ingestion.runs} · ${r.ingestion.failedRuns} ${t("qualityFailed")} (${formatRate(r.ingestion.failureRate)})`, `${t("qualityLag")}: ${v(r.ingestion.urgentLagP95Seconds, "s")}`]}
          />
          <Block
            title={t("qualityModeration")}
            lines={[
              `${r.moderation.openCases} ${t("qualityOpen")} · ${r.moderation.resolvedCases} ${t("qualityResolved")} (${v(r.moderation.medianResolutionHours, "h")})`,
              `${r.moderation.appealsReversed}/${r.moderation.appealsDecided} ${t("qualityAppeals")}`,
            ]}
          />
          <Text style={styles.note}>{r.period.from} → {r.period.to}</Text>
        </>
      )}
    </ScrollView>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {lines.map((l, i) => <Text key={i} style={styles.sub}>{l}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  ranges: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  range: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  rangeOn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  rangeText: { color: colors.text },
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  rowLabel: { flex: 1 },
  rowText: { color: colors.text },
  value: { color: colors.textMuted, fontSize: 13 },
  amount: { color: colors.text, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xs, marginTop: space.sm },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.lg },
});
