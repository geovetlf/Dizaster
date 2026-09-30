import type { ClientCrashGroup } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

const PERIODS = [1, 7, 30] as const;

/** Fallos de la app agrupados (ADR 0173): solo operación. Sin cuentas: mensaje, primer marco, plataformas y versiones. */
export default function AdminCrashesScreen() {
  const [days, setDays] = useState<number>(7);
  const [groups, setGroups] = useState<ClientCrashGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.adminClientCrashes(days).then((r) => { setGroups(r.groups); setTotal(r.total); setError(null); }).catch((e: Error) => setError(e.message));
  }, [days]);
  useFocusEffect(load);

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={groups}
      keyExtractor={(g) => g.fingerprint}
      ListHeaderComponent={
        <View style={{ gap: space.sm }}>
          <View style={styles.row}>
            {PERIODS.map((d) => (
              <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: d === days }} onPress={() => setDays(d)}
                style={[styles.chip, d === days && styles.chipOn]}>
                <Text style={styles.chipText}>{d === 1 ? "24 h" : `${d} d`}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.meta}>{t("crashTotal")}: {total}</Text>}
        </View>
      }
      ListEmptyComponent={error ? null : <Text style={styles.meta}>{t("crashNone")}</Text>}
      renderItem={({ item: g }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.title} numberOfLines={3}>{g.message}</Text>
            <Text style={styles.count}>×{g.count}</Text>
          </View>
          {g.firstFrame ? <Text style={styles.mono} numberOfLines={2}>{g.firstFrame}</Text> : null}
          <Text style={styles.meta}>
            {[g.where, g.platforms.join("/"), g.appVersions.join(", ")].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.meta}>{t("crashLast")} {timeAgo(g.lastAt, lang)}{g.lastRequestId ? ` · ${g.lastRequestId}` : ""}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, fontWeight: "700", flex: 1 },
  count: { color: colors.accentText, fontWeight: "700" },
  mono: { color: colors.textMuted, fontFamily: "monospace", fontSize: 12 },
  meta: { color: colors.textMuted },
  error: { color: colors.accentText },
  chip: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text },
});
