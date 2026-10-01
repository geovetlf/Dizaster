import type { OriginalAccessEntry, PresenceAccessEntry } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ErrorText } from "../components/error-text";
import { shortId } from "../lib/admin/admin-tools";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { appendPage } from "../lib/ui/pages";
import { colors, radius, space } from "../theme";

/** Quién consultó: el alias si existe; si no, el id corto (ADR 0299). */
function actor(e: { actorUserId: string; actorHandle?: string | null }): string {
  return e.actorHandle ? `@${e.actorHandle}` : shortId(e.actorUserId);
}

/** Registro inmutable de consultas a la evidencia de presencia (ADR 0089, ADR 0098). Solo administración. */
export default function AdminPresenceScreen() {
  const [entries, setEntries] = useState<PresenceAccessEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Originales de media vistos por moderación (ADR 0168): mismo principio, otro registro.
  const [originals, setOriginals] = useState<OriginalAccessEntry[]>([]);
  const [originalsNext, setOriginalsNext] = useState<string | null>(null);
  const [originalsBusy, setOriginalsBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    setError(null);
    api.presenceAccessLog().then((r) => { setEntries(r.entries); setNext(r.nextCursor); }).catch((e: Error) => setError(e.message));
    api.originalAccessLog().then((r) => { setOriginals(r.entries); setOriginalsNext(r.nextCursor); }).catch((e: Error) => setError(e.message));
  }, []));

  /** Página siguiente de presencias (ADR 0299): sin repetir lo ya cargado. */
  function more() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    api.presenceAccessLog(next)
      .then((r) => { setEntries((l) => appendPage(l ?? [], r.entries)); setNext(r.nextCursor); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }

  function olderOriginals() {
    if (!originalsNext || originalsBusy) return;
    setOriginalsBusy(true);
    api.originalAccessLog(originalsNext)
      .then((r) => { setOriginals((l) => appendPage(l, r.entries)); setOriginalsNext(r.nextCursor); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setOriginalsBusy(false));
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={entries ?? []}
      keyExtractor={(e) => e.id}
      onEndReached={more}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={(
        <View style={{ gap: space.xs }}>
          <Text style={styles.meta}>{t("presenceLogHint")}</Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      )}
      ListEmptyComponent={entries ? <Text style={styles.meta}>{t("presenceLogEmpty")}</Text> : null}
      ListFooterComponent={originals.length ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Text style={styles.title}>{t("originalLogTitle")}</Text>
          {originals.map((o) => (
            <View key={o.id} style={styles.card}>
              <Text style={styles.title}>{timeAgo(o.accessedAt, lang)}</Text>
              <Text style={styles.text}>{o.reason}</Text>
              <Text style={styles.meta}>{t("presenceLogActor")} {actor(o)} · {t("mediaWord")} {shortId(o.mediaId)}{o.caseId ? ` · ${t("presenceLogCase")} ${shortId(o.caseId)}` : ""}</Text>
            </View>
          ))}
          {originalsNext ? (
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: originalsBusy }} disabled={originalsBusy}
              style={[styles.button, originalsBusy && styles.disabled]} onPress={olderOriginals}>
              <Text style={styles.buttonText}>{t("originalLogOlder")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{timeAgo(item.accessedAt, lang)} · {item.preciseShown ? t("presenceLogPrecise") : t("presenceLogGeneral")}</Text>
          <Text style={styles.text}>{item.reason}</Text>
          <Text style={styles.meta}>{t("presenceLogActor")} {actor(item)} · {t("presenceLogReport")} {shortId(item.reportId)}{item.caseId ? ` · ${t("presenceLogCase")} ${shortId(item.caseId)}` : ""}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  text: { color: colors.text },
  meta: { color: colors.textMuted, fontSize: 13 },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontWeight: "700" },
});
