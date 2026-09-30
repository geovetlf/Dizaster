import type { SessionView } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { locale, t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/**
 * Sesiones abiertas de la cuenta: dónde está iniciada y cerrar las demás (p. ej. un teléfono perdido). Un
 * dispositivo cerrado deja de recibir avisos. Sin IP ni ubicación.
 */
export default function SessionsScreen() {
  const [list, setList] = useState<SessionView[] | null>(null);
  const load = useCallback(() => { api.sessions().then((r) => setList(r.sessions)).catch(() => setList([])); }, []);
  useFocusEffect(load);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  function close(s: SessionView) {
    Alert.alert(t("closeSession"), t("closeSessionConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("closeSession"), style: "destructive", onPress: () => { api.revokeSession(s.id).then(load).catch(load); } },
    ]);
  }

  function closeOthers() {
    Alert.alert(t("closeOtherSessions"), t("closeSessionConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("closeOtherSessions"), style: "destructive", onPress: () => { api.revokeOtherSessions().then(load).catch(load); } },
    ]);
  }

  const others = list?.filter((s) => !s.current) ?? [];
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {list?.map((s) => (
        <View key={s.id} style={styles.row}>
          <Icon name={s.platform === "IOS" ? "apple" : s.platform === "ANDROID" ? "android" : "cellphone"} size={24} color={colors.text} />
          <View style={styles.body}>
            <Text style={styles.title}>{s.platform === "IOS" ? "iPhone" : s.platform === "ANDROID" ? "Android" : t("unknownDevice")}{s.current ? ` · ${t("thisDevice")}` : ""}</Text>
            <Text style={styles.meta}>{t("sessionSince")} {date(s.startedAt)} · {t("sessionLastActive")} {date(s.lastActiveAt)}{s.appVersion ? ` · v${s.appVersion}` : ""}</Text>
          </View>
          {s.current ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={t("closeSession")} hitSlop={8} onPress={() => close(s)}>
              <Icon name="logout" size={22} color={colors.accent} />
            </Pressable>
          )}
        </View>
      ))}
      {others.length > 0 ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={closeOthers}>
          <Text style={styles.buttonText}>{t("closeOtherSessions")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.note}>{t("sessionsNote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  button: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, paddingVertical: space.md, alignItems: "center", marginTop: space.md },
  buttonText: { color: colors.accentText, fontWeight: "700" },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.md },
});
