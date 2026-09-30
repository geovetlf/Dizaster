import { can, isStaff } from "@dizaster/contracts";
import * as Application from "expo-application";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, type IconProps } from "../../components/icon";
import { exportMyData } from "../../lib/account/export";
import { api } from "../../lib/api";
import { enablePush } from "../../lib/device/push";
import { lang, t } from "../../lib/i18n";
import { LANGUAGE_NAMES } from "../../lib/language";
import { reportQueue } from "../../lib/report/outbox";
import { useSession } from "../../lib/session";
import { isRtlNow } from "../../lib/ui/apply-direction";
import { forwardChevron } from "../../lib/ui/direction";
import { colors, radius, space } from "../../theme";

/** Perfil: acceso al perfil público y ajustes de este teléfono. */
export default function ProfileScreen() {
  const session = useSession();
  const [alerts, setAlerts] = useState(false);
  const [pending, setPending] = useState(0);
  const [handle, setHandle] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [notices, setNotices] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!session.ready) return;
    api.me().then((p) => setHandle(p.handle)).catch(() => setHandle(null));
    api.account().then((a) => setRoles(a.roles)).catch(() => setRoles([]));
    api.myModeration().then((r) => setNotices(r.notices.length)).catch(() => setNotices(0));
  }, [session.ready]);

  useFocusEffect(
    useCallback(() => {
      Notifications.getPermissionsAsync().then((p) => setAlerts(p.granted)).catch(() => undefined);
      reportQueue.pending().then((p) => setPending(p.length)).catch(() => undefined);
    }, []),
  );

  /** Pide permiso en contexto; si el sistema ya no lo muestra, lleva a los ajustes de alertas (y desde ahí a los del sistema). */
  async function turnOnAlerts() {
    if (!session.deviceId) return;
    const on = await enablePush(session.deviceId).catch(() => false);
    setAlerts(on);
    router.push("/alert-settings");
  }

  async function onExport() {
    if (exporting) return;
    setExporting(true);
    try {
      if ((await exportMyData()) === "saved") Alert.alert(t("exportData"), t("exportSaved"));
    } catch {
      Alert.alert(t("exportData"), t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("profile")}</Text>
        {handle ? <Row icon="account-circle-outline" label={t("myPublicProfile")} value={`@${handle}`} onPress={() => router.push(`/u/${handle}`)} /> : null}
        {handle ? <Row icon="account-edit-outline" label={t("editProfile")} onPress={() => router.push("/profile-edit")} /> : null}
        <Row icon="bell-outline" label={t("alerts")} value={alerts ? t("alertsOn") : t("alertsOff")} onPress={() => (alerts ? router.push("/alert-settings") : void turnOnAlerts())} />
        <Row icon="cloud-upload-outline" label={t("pendingReports")} value={String(pending)} />
        <Row icon="clipboard-text-clock-outline" label={t("myReports")} onPress={() => router.push("/my-reports")} />
        <Row icon="star-outline" label={t("followingTitle")} onPress={() => router.push("/following")} />
        <Row icon="account-cancel-outline" label={t("blockedTitle")} onPress={() => router.push("/blocked")} />
        <Row icon="phone-alert" label={t("emergencyTitle")} onPress={() => router.push("/emergency")} />
        {notices > 0 ? <Row icon="gavel" label={t("myModeration")} value={String(notices)} onPress={() => router.push("/my-moderation")} /> : null}
        {can(roles, "event.verify") ? <Row icon="shield-check-outline" label={t("moderation")} onPress={() => router.push("/moderation")} /> : null}
        {can(roles, "ops.view") ? <Row icon="chart-bar" label={t("costTitle")} onPress={() => router.push("/admin-cost")} /> : null}
        {can(roles, "ops.view") ? <Row icon="gauge" label={t("qualityTitle")} onPress={() => router.push("/admin-quality")} /> : null}
        {can(roles, "ops.view") ? <Row icon="access-point-network" label={t("adminSources")} onPress={() => router.push("/admin-sources")} /> : null}
        {can(roles, "admin") ? <Row icon="storefront-check-outline" label={t("adminBusinesses")} onPress={() => router.push("/admin-businesses")} /> : null}
        {can(roles, "admin") ? <Row icon="map-marker-account-outline" label={t("presenceLogTitle")} onPress={() => router.push("/admin-presence")} /> : null}
        {can(roles, "admin") ? <Row icon="timer-sand" label={t("adminDelays")} onPress={() => router.push("/admin-delays")} /> : null}
        {can(roles, "admin") ? <Row icon="scale-balance" label={t("adminAuthority")} onPress={() => router.push("/admin-authority")} /> : null}
        {can(roles, "admin") ? <Row icon="file-chart-outline" label={t("adminTransparency")} onPress={() => router.push("/admin-transparency")} /> : null}
        {isStaff(roles) ? <Row icon="two-factor-authentication" label={t("mfaTitle")} onPress={() => router.push("/mfa")} /> : null}
        <Row icon="storefront-outline" label={t("myBusinesses")} onPress={() => router.push("/my-businesses")} />
        <Row icon="cellphone-lock" label={t("sessionsTitle")} onPress={() => router.push("/sessions")} />
        <Row icon="download-outline" label={t("exportData")} value={exporting ? t("exportPreparing") : undefined} onPress={() => void onExport()} />
        <Row icon="account-remove-outline" label={t("deleteAccount")} onPress={() => router.push("/delete-account")} />
        <Row icon="translate" label={t("language")} value={LANGUAGE_NAMES[lang]} onPress={() => router.push("/language")} />
        <Row icon="information-outline" label={t("aboutTitle")} onPress={() => router.push("/about")} />
        <Text style={styles.note}>{t("privacyNote")}</Text>
        <Text style={styles.version}>Dizaster {Application.nativeApplicationVersion ?? ""}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value, onPress }: { icon: IconProps["name"]; label: string; value?: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : "text"} disabled={!onPress} style={styles.row} onPress={onPress}>
      <Icon name={icon} size={22} color={colors.text} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={[styles.rowValue, onPress && styles.rowAction]}>{value}</Text> : <Icon name={forwardChevron(isRtlNow())} size={22} color={colors.textMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm },
  rowLabel: { flex: 1, color: colors.text, fontSize: 15 },
  rowValue: { color: colors.textMuted },
  rowAction: { color: colors.accent, fontWeight: "600" },
  note: { color: colors.textMuted, marginTop: space.lg },
  version: { color: colors.textMuted, marginTop: space.xl, fontSize: 12 },
});
