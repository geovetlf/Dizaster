import type { MyReportView } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { uploadErrorText } from "../lib/media/upload-errors";
import { canWithdraw, myReportLines, queuedState } from "../lib/report/my-reports";
import { discardQueuedReport, reportQueue, retryQueuedReport } from "../lib/report/outbox";
import type { QueuedReport } from "../lib/report/queue";
import { formatInZone, timeAgo } from "../lib/ui/format";
import { appendPage } from "../lib/ui/pages";
import { colors, radius, space } from "../theme";
import { categoryLabel } from "../lib/category-store";
import { askSameEvent } from "../lib/report/same-event";
import { ErrorText } from "../components/error-text";

const categoryName = categoryLabel;
const fmt = (iso: string) => formatInZone(iso, lang, undefined, "datetime") ?? iso;

/** Mis reportes (ADR 0094): qué pasó con cada uno, cuándo se borra la ubicación precisa, y retirarlo. */
export default function MyReportsScreen() {
  const [reports, setReports] = useState<MyReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lo que sigue en el teléfono (ADR 0158): sin red, reintentando o detenido. Nunca se borra sin preguntar.
  const [queued, setQueued] = useState<QueuedReport[]>([]);
  // Por páginas (ADR 0287): al llegar al final se piden los anteriores.
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(() => {
    reportQueue.pending().then(setQueued).catch(() => setQueued([]));
    api.myReports().then((r) => { setReports(r.reports); setNext(r.nextCursor); }).catch((e: Error) => setError(e.message));
  }, []);

  function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    api.myReports(next)
      .then((r) => { setReports((prev) => appendPage(prev ?? [], r.reports)); setNext(r.nextCursor); })
      .catch(() => setError(t("loadError")))
      .finally(() => setLoadingMore(false));
  }

  function confirmDiscard(q: QueuedReport) {
    Alert.alert(t("queuedDiscard"), t("queuedDiscardConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("queuedDiscard"), style: "destructive", onPress: () => void discardQueuedReport(q.clientReportId).then(load) },
    ]);
  }

  const queuedHeader = queued.length ? (
    <View>
      <Text style={styles.section}>{t("queuedTitle")}</Text>
      {queued.map((q) => {
        const state = queuedState(q);
        return (
          <View key={q.clientReportId} style={styles.card}>
            <Text style={styles.title}>{categoryName(q.body.categoryCode)} · {timeAgo(q.createdAt, lang)}</Text>
            <Text style={styles.meta}>{t(`queuedState_${state}`)}{state === "STUCK" && q.stuck ? ` · ${uploadErrorText(q.stuck.reason, t)}` : ""}</Text>
            {q.media?.length ? <Text style={styles.meta}>{t("queuedMediaKept")}</Text> : null}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => void retryQueuedReport(q.clientReportId).then(load).catch(load)}><Text style={styles.link}>{t("queuedRetry")}</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => confirmDiscard(q)}><Text style={styles.danger}>{t("queuedDiscard")}</Text></Pressable>
            </View>
          </View>
        );
      })}
    </View>
  ) : null;
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
      ListHeaderComponent={<>{queuedHeader}{error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}</>}
      ListEmptyComponent={reports ? <Text style={styles.meta}>{t("myReportsEmpty")}</Text> : null}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{categoryName(item.categoryCode)} · {timeAgo(item.capturedAt, lang)}</Text>
          {myReportLines(item, t, fmt).map((line) => <Text key={line} style={styles.meta}>{line}</Text>)}
          <View style={styles.actions}>
            {item.eventId && item.status !== "WITHDRAWN" ? (
              <Pressable accessibilityRole="link" onPress={() => router.push(`/event/${item.eventId}`)}><Text style={styles.link}>{t("myReportOpenEvent")}</Text></Pressable>
            ) : null}
            {item.askSameEvent && item.status === "ACCEPTED" ? (
              <Pressable accessibilityRole="button" onPress={() => askSameEvent(item.id, load)}><Text style={styles.link}>{t("sameEventTitle")}</Text></Pressable>
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
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: space.sm },
  meta: { color: colors.textMuted, fontSize: 13 },
  actions: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  link: { color: colors.accentText, fontWeight: "600" },
  danger: { color: colors.accentText, fontWeight: "600" },
  error: { color: colors.accentText, marginBottom: space.sm },
});
