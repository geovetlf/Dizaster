import { STAFF_ROLES, type StaffResponse, type StaffRole } from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { validReason } from "../lib/admin/sources-format";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/**
 * Personal y roles (§13.1, ADR 0167). Solo administración. Dar o quitar un rol pide motivo y queda registrado; quitarlo
 * cierra las sesiones de esa persona. El servidor nunca deja el sistema sin administradores.
 */
export default function AdminStaffScreen() {
  const [data, setData] = useState<StaffResponse | null>(null);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<StaffRole>("moderator");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.adminStaff().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);

  function change(target: string, r: StaffRole, action: "GRANT" | "REVOKE") {
    Alert.alert(`@${target}`, t(action === "GRANT" ? "roleGrantConfirm" : "roleRevokeConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("apply"),
        onPress: () => {
          setBusy(true);
          api.changeRole({ handle: target, role: r, action, reason: reason.trim() })
            .then(() => { setReason(""); setHandle(""); load(); })
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const ok = validReason(reason) && !busy;
  const target = handle.trim().replace(/^@/, "");
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />

      <Text style={styles.section}>{t("roleGrantSection")}</Text>
      <TextInput accessibilityLabel={t("staffHandle")} value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={41} placeholder="@handle" placeholderTextColor={colors.textMuted} style={styles.input} />
      <View style={styles.chips}>
        {STAFF_ROLES.map((r) => (
          <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: role === r }} style={[styles.chip, role === r && styles.chipOn]} onPress={() => setRole(r)}>
            <Text style={styles.chipText}>{t(`role_${r}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok || !target }} disabled={!ok || !target}
        style={[styles.button, (!ok || !target) && styles.disabled]} onPress={() => change(target, role, "GRANT")}>
        <Text style={styles.buttonText}>{t("roleGrant")}</Text>
      </Pressable>

      <Text style={styles.section}>{t("staffSection")}</Text>
      {data?.staff.map((m) => (
        <View key={m.handle} style={styles.card}>
          <Text style={styles.title}>@{m.handle}</Text>
          <View style={styles.chips}>
            {m.roles.map((r) => (
              <Pressable key={r} accessibilityRole="button" accessibilityLabel={`${t("roleRevoke")} ${t(`role_${r}`)}`} accessibilityState={{ disabled: !ok }} disabled={!ok}
                style={[styles.chip, !ok && styles.disabled]} onPress={() => change(m.handle, r, "REVOKE")}>
                <Text style={styles.chipText}>{t(`role_${r}`)} ✕</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.section}>{t("roleChanges")}</Text>
      {data?.changes.map((c) => (
        <Text key={`${c.at}-${c.role}-${c.handle ?? ""}`} style={styles.meta}>
          {timeAgo(c.at, lang)} · {c.action === "GRANT" ? "+" : "−"} {t(`role_${c.role}`)} · @{c.handle ?? "—"} · {c.reason}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  section: { color: colors.text, fontWeight: "700", marginTop: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  title: { color: colors.text, fontWeight: "700" },
  meta: { color: colors.textMuted },
  error: { color: colors.accentText },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontWeight: "700" },
});
