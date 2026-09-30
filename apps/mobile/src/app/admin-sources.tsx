import type { AdminSourceView } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HEALTH_COLOR, sortSources, sourceAction, validReason } from "../lib/admin/sources-format";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/**
 * Salud de las fuentes y pausa/reanudación (§5.21, §9.2, ADR 0162). Verla y cambiarla es de operación; cada cambio
 * pide motivo y queda registrado. Activar una fuente nueva no se hace desde aquí.
 */
export default function AdminSourcesScreen() {
  const [sources, setSources] = useState<AdminSourceView[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.adminSources().then((r) => { setSources(sortSources(r.sources)); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);

  function change(s: AdminSourceView, to: "ACTIVE" | "PAUSED") {
    Alert.alert(s.name, t(to === "PAUSED" ? "sourcePauseConfirm" : "sourceResumeConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("apply"),
        onPress: () => {
          setBusy(true);
          api.setSourceStatus(s.key, to, reason.trim())
            .then(() => { setReason(""); load(); })
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const ok = validReason(reason) && !busy;
  return (
    <FlatList automaticallyAdjustKeyboardInsets
      style={styles.container}
      contentContainerStyle={styles.content}
      data={sources}
      keyExtractor={(s) => s.key}
      ListHeaderComponent={
        <View style={{ gap: space.sm }}>
          {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.meta}>{t("sourcesHint")}</Text>}
          <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
        </View>
      }
      renderItem={({ item: s }) => {
        const action = sourceAction(s);
        return (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: HEALTH_COLOR[s.health] }]} />
              <Text style={styles.title}>{s.name}</Text>
              {s.urgentCapable ? <Text style={styles.badge}>{t("sourceUrgent")}</Text> : null}
            </View>
            <Text style={styles.meta}>
              {t(`sourceHealth_${s.health}`)} · {s.status}
              {s.lastOkAt ? ` · ${t("sourceLastOk")} ${timeAgo(s.lastOkAt, lang)}` : ""}
            </Text>
            <Text style={styles.meta}>{t("sourceLast24h")}: {s.runsOk} ✓ · {s.runsFailed} ✗ · {s.itemsNew} {t("sourceNewItems")}</Text>
            {s.breakerOpenUntil ? <Text style={styles.warn}>{t("sourceRetryAt")} {s.breakerOpenUntil.slice(11, 16)} UTC</Text> : null}
            {s.lastError ? <Text style={styles.warn} numberOfLines={2}>{s.lastError}</Text> : null}
            {s.lastStatusChange ? (
              <Text style={styles.meta}>{timeAgo(s.lastStatusChange.at, lang)} · {s.lastStatusChange.from} → {s.lastStatusChange.to} · {s.lastStatusChange.reason}</Text>
            ) : null}
            {action ? (
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok}
                style={[styles.button, !ok && styles.disabled]} onPress={() => change(s, action === "PAUSE" ? "PAUSED" : "ACTIVE")}>
                <Text style={styles.buttonText}>{t(action === "PAUSE" ? "sourcePause" : "sourceResume")}</Text>
              </Pressable>
            ) : null}
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
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.text, fontWeight: "700", flex: 1 },
  badge: { color: colors.accentText, fontSize: 12, fontWeight: "700" },
  meta: { color: colors.textMuted },
  warn: { color: "#FACC15" },
  error: { color: colors.accentText },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, marginTop: space.xs },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontWeight: "700" },
});
