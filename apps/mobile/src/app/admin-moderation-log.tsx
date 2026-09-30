import type { ModerationActionLogEntry } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { lang, t, type MessageKey } from "../lib/i18n";
import { formatInZone } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/**
 * Registro de moderación (§5.21, §13.1, ADR 0239). Solo administración y solo lectura: qué acción, sobre qué, por qué
 * y quién la tomó (o si fue automática). Se puede filtrar por el handle de quien moderó.
 */
export default function AdminModerationLogScreen() {
  const [moderator, setModerator] = useState("");
  const [items, setItems] = useState<ModerationActionLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((who: string, after: string | null) => {
    api.moderationActions(who.trim() || undefined, after)
      .then((r) => { setItems((prev) => (after ? [...prev, ...r.actions] : r.actions)); setCursor(r.nextCursor); setError(null); })
      .catch((e: Error) => { if (!after) setItems([]); setError(e.message); });
  }, []);
  // Al volver a la pantalla se recarga con el filtro vigente; escribir en el filtro no recarga hasta "buscar".
  const filter = useRef(moderator);
  filter.current = moderator;
  useFocusEffect(useCallback(() => { load(filter.current, null); }, [load]));

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <TextInput
            style={styles.input}
            value={moderator}
            onChangeText={setModerator}
            onSubmitEditing={() => load(moderator, null)}
            placeholder={t("moderationLogFilter")}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t("moderationLogFilter")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={error ? null : <Text style={styles.meta}>{t("moderationLogEmpty")}</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{t(`action_${item.action}` as MessageKey)} · {item.targetType}</Text>
          <Text style={styles.meta}>
            {formatInZone(item.createdAt, lang, undefined, "datetime") ?? item.createdAt} · {item.actor === "RULE" ? t("moderationLogAutomatic") : `@${item.moderatorHandle ?? "—"}`}
          </Text>
          <Text style={styles.reason}>{item.reason}</Text>
        </View>
      )}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (cursor) load(moderator, cursor); }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  header: { gap: space.sm, marginBottom: space.sm },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 44 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  reason: { color: colors.text, fontStyle: "italic" },
  error: { color: colors.accentText, fontSize: 13 },
});
