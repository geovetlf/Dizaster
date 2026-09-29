import type { CategoryCatalog, MyReportView } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { canWithdraw, myReportLines } from "../lib/report/my-reports";
import { formatInZone, timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;
const categoryName = (code: string) => {
  const c = catalog.categories.find((x) => x.code === code);
  return c?.names[lang] ?? c?.names["es"] ?? code;
};
const fmt = (iso: string) => formatInZone(iso, lang, undefined, "datetime") ?? iso;

/** Mis reportes (ADR 0094): qué pasó con cada uno, cuándo se borra la ubicación precisa, y retirarlo. */
export default function MyReportsScreen() {
  const [reports, setReports] = useState<MyReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.myReports().then((r) => setReports(r.reports)).catch((e: Error) => setError(e.message)); }, []);
  useFocusEffect(load);

  function confirmWithdraw(r: MyReportView) {
    Alert.alert(t("myReportWithdraw"), t("myReportWithdrawConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("myReportWithdraw"), style: "destructive", onPress: () => void api.withdrawReport(r.id).then(load).catch((e: Error) => setError(e.message)) },
    ]);
  }

  return (
    <FlatList
      style={styles.container}
      data={reports ?? []}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={reports ? <Text style={styles.meta}>{t("myReportsEmpty")}</Text> : null}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{categoryName(item.categoryCode)} · {timeAgo(item.capturedAt, lang)}</Text>
          {myReportLines(item, t, fmt).map((line) => <Text key={line} style={styles.meta}>{line}</Text>)}
          <View style={styles.actions}>
            {item.eventId && item.status !== "WITHDRAWN" ? (
              <Pressable accessibilityRole="link" onPress={() => router.push(`/event/${item.eventId}`)}><Text style={styles.link}>{t("myReportOpenEvent")}</Text></Pressable>
            ) : null}
            {canWithdraw(item) ? (
              <Pressable accessibilityRole="button" onPress={() => confirmWithdraw(item)}><Text style={styles.danger}>{t("myReportWithdraw")}</Text></Pressable>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  actions: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  link: { color: colors.accent, fontWeight: "600" },
  danger: { color: colors.accent, fontWeight: "600" },
  error: { color: colors.accent, marginBottom: space.sm },
});
