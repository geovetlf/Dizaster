import type { CategoryCatalog, PublishDelayView } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseDelayMinutes } from "../lib/admin/admin-tools";
import { validReason } from "../lib/admin/sources-format";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { colors, radius, space } from "../theme";
import { ErrorText } from "../components/error-text";

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
  const [reason, setReason] = useState("");
  const ok = validReason(reason);

  useFocusEffect(useCallback(() => {
    Promise.all(SENSITIVE.map((c) => api.publishDelay(c.code)))
      .then((list) => setViews(Object.fromEntries(list.map((v) => [v.category, v]))))
      .catch((e: Error) => setError(e.message));
  }, []));

  function save(code: string) {
    const minutes = parseDelayMinutes(drafts[code] ?? "");
    if (minutes === null) { setError(t("delayInvalid")); return; }
    if (!ok) { setError(t("actionReason")); return; }
    api.setPublishDelay(code, minutes, reason.trim())
      .then((v) => { setViews((prev) => ({ ...prev, [code]: v })); setDrafts((prev) => ({ ...prev, [code]: "" })); setError(null); })
      .catch((e: Error) => setError(e.message));
  }

  return (
    <FlatList automaticallyAdjustKeyboardInsets
      style={styles.container}
      contentContainerStyle={styles.content}
      data={SENSITIVE}
      keyExtractor={(c) => c.code}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.meta}>{t("delayHint")}</Text>
          {error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}
          <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} maxLength={500} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={[styles.input, styles.reason]} />
        </View>
      }
      renderItem={({ item }) => {
        const v = views[item.code];
        return (
          <View style={styles.card}>
            <Text style={styles.title}>{item.names[lang] ?? item.names["es"] ?? item.code}</Text>
            <Text style={styles.meta}>
              {v ? `${v.minutes} min${v.overridden ? ` · ${t("delayCatalog")} ${v.catalogMinutes} min` : ""}` : "…"}
            </Text>
            <View style={styles.editRow}>
              <TextInput accessibilityLabel={t("delayMinutes")}
                value={drafts[item.code] ?? ""}
                onChangeText={(x) => setDrafts((prev) => ({ ...prev, [item.code]: x }))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder={t("delayMinutes")}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok} style={[styles.apply, !ok && styles.disabled]} onPress={() => save(item.code)}>
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
  error: { color: colors.accentText },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  input: { flex: 1, color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  apply: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  applyText: { color: colors.white, fontWeight: "700" },
  header: { gap: space.sm, marginBottom: space.sm },
  reason: { flex: 0, backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
});
