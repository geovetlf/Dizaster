import type { CategoryCatalog, PublishDelayView } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseDelayMinutes } from "../lib/admin/admin-tools";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;
/** Solo las categorías muy sensibles admiten retraso de publicación (§8.5). */
const SENSITIVE = catalog.categories.filter((c) => c.sensitivity === "HIGHLY_SENSITIVE");

/**
 * Retraso de publicación por categoría (ADR 0109). Solo administración. El reporte se recibe y guarda al momento;
 * lo que espera es su publicación pública.
 */
export default function AdminDelaysScreen() {
  const [views, setViews] = useState<Record<string, PublishDelayView>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    Promise.all(SENSITIVE.map((c) => api.publishDelay(c.code)))
      .then((list) => setViews(Object.fromEntries(list.map((v) => [v.category, v]))))
      .catch((e: Error) => setError(e.message));
  }, []));

  function save(code: string) {
    const minutes = parseDelayMinutes(drafts[code] ?? "");
    if (minutes === null) { setError(t("delayInvalid")); return; }
    api.setPublishDelay(code, minutes)
      .then((v) => { setViews((prev) => ({ ...prev, [code]: v })); setDrafts((prev) => ({ ...prev, [code]: "" })); setError(null); })
      .catch((e: Error) => setError(e.message));
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={SENSITIVE}
      keyExtractor={(c) => c.code}
      ListHeaderComponent={<Text style={error ? styles.error : styles.meta}>{error ?? t("delayHint")}</Text>}
      renderItem={({ item }) => {
        const v = views[item.code];
        return (
          <View style={styles.card}>
            <Text style={styles.title}>{item.names[lang] ?? item.names["es"] ?? item.code}</Text>
            <Text style={styles.meta}>
              {v ? `${v.minutes} min${v.overridden ? ` · ${t("delayCatalog")} ${v.catalogMinutes} min` : ""}` : "…"}
            </Text>
            <View style={styles.editRow}>
              <TextInput
                value={drafts[item.code] ?? ""}
                onChangeText={(x) => setDrafts((prev) => ({ ...prev, [item.code]: x }))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder={t("delayMinutes")}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" style={styles.apply} onPress={() => save(item.code)}>
                <Text style={styles.applyText}>{t("apply")}</Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  meta: { color: colors.textMuted },
  error: { color: colors.accent },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  input: { flex: 1, color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  apply: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  applyText: { color: colors.white, fontWeight: "700" },
});
