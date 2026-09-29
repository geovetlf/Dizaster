import type { PresenceAccessEntry } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { shortId } from "../lib/admin/admin-tools";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/** Registro inmutable de consultas a la evidencia de presencia (ADR 0089, ADR 0098). Solo administración. */
export default function AdminPresenceScreen() {
  const [entries, setEntries] = useState<PresenceAccessEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.presenceAccessLog().then((r) => setEntries(r.entries)).catch((e: Error) => setError(e.message)); }, []));
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={entries ?? []}
      keyExtractor={(e) => e.id}
      ListHeaderComponent={<Text style={styles.meta}>{error ?? t("presenceLogHint")}</Text>}
      ListEmptyComponent={entries ? <Text style={styles.meta}>{t("presenceLogEmpty")}</Text> : null}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{timeAgo(item.accessedAt, lang)} · {item.preciseShown ? t("presenceLogPrecise") : t("presenceLogGeneral")}</Text>
          <Text style={styles.text}>{item.reason}</Text>
          <Text style={styles.meta}>{t("presenceLogActor")} {shortId(item.actorUserId)} · {t("presenceLogReport")} {shortId(item.reportId)}{item.caseId ? ` · ${t("presenceLogCase")} ${shortId(item.caseId)}` : ""}</Text>
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
});
