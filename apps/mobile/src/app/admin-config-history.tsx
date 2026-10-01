import { CONFIG_CHANGE_KINDS, type ConfigChangeKind, type ConfigChangeView } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { configValue } from "../lib/admin/config-history";
import { api } from "../lib/api";
import { lang, t, type MessageKey } from "../lib/i18n";
import { formatInZone } from "../lib/ui/format";
import { colors, radius, space } from "../theme";
import { ErrorText } from "../components/error-text";

/**
 * Historial de configuración (§13.1, ADR 0219). Solo administración y solo lectura: quién cambió qué, cuándo, el
 * valor anterior, el nuevo y el motivo. El servidor no deja editar ni borrar entradas.
 */
export default function AdminConfigHistoryScreen() {
  const [kind, setKind] = useState<ConfigChangeKind | undefined>(undefined);
  const [items, setItems] = useState<ConfigChangeView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((k: ConfigChangeKind | undefined, after: string | null) => {
    api.configChanges(k, after)
      .then((r) => { setItems((prev) => (after ? [...prev, ...r.changes] : r.changes)); setCursor(r.nextCursor); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(useCallback(() => { load(kind, null); }, [load, kind]));

  const kindLabel = (k: ConfigChangeKind) => t(`configKind_${k}` as MessageKey);
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={styles.chips}>
          {[undefined, ...CONFIG_CHANGE_KINDS].map((k) => (
            <Pressable key={k ?? "all"} accessibilityRole="button" accessibilityState={{ selected: kind === k }} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)}>
              <Text style={styles.chipText}>{k ? kindLabel(k) : t("configAll")}</Text>
            </Pressable>
          ))}
          {error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}
        </View>
      }
      ListEmptyComponent={error ? null : <Text style={styles.meta}>{t("configHistoryEmpty")}</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{kindLabel(item.kind)} · {item.target}</Text>
          <Text style={styles.meta}>{formatInZone(item.at, lang, undefined, "datetime") ?? item.at} · @{item.actorHandle ?? "—"}</Text>
          <Text style={styles.value}>{t("configBefore")}: {configValue(item.previous)}</Text>
          <Text style={styles.value}>{t("configAfter")}: {configValue(item.next)}</Text>
          <Text style={styles.reason}>{item.reason}</Text>
        </View>
      )}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (cursor) load(kind, cursor); }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm },
  chip: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.text, fontSize: 13 },
  reason: { color: colors.text, fontStyle: "italic" },
  error: { color: colors.accentText, fontSize: 13 },
});
