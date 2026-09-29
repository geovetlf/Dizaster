import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useNotificationRouting } from "../lib/alerts/notifications";
import { refreshEmergencyDataset } from "../lib/emergency-store";
import { isAgeBlocked } from "../lib/account/age-gate";
import { api } from "../lib/api";
import { onLanguageChange } from "../lib/language-store";
import { SessionProvider, useSession } from "../lib/session";
import { colors } from "../theme";

const header = { headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerTitleAlign: "center" as const, contentStyle: { backgroundColor: colors.bg } };

export default function RootLayout() {
  // Al abrir la app se comprueba si hay números de emergencia nuevos; así funcionan offline con la última versión.
  useEffect(() => { void refreshEmergencyDataset(); }, []);
  // Cambiar el idioma vuelve a montar la navegación para que títulos y pantallas usen el nuevo (ADR 0069).
  const [langKey, setLangKey] = useState(0);
  useEffect(() => onLanguageChange(() => setLangKey((k) => k + 1)), []);
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack key={langKey} screenOptions={header}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="report" options={{ title: t("report"), presentation: "modal" }} />
        <Stack.Screen name="emergency" options={{ title: t("emergency"), presentation: "modal" }} />
        <Stack.Screen name="search" options={{ title: t("searchCategories"), presentation: "modal" }} />
        <Stack.Screen name="event/[id]" options={{ title: "" }} />
        <Stack.Screen name="post/[id]" options={{ title: t("comments") }} />
        <Stack.Screen name="u/[handle]" options={{ title: "" }} />
        <Stack.Screen name="alerts" options={{ title: t("alertsTitle") }} />
        <Stack.Screen name="alert-settings" options={{ title: t("alertSettings") }} />
        <Stack.Screen name="admin-cost" options={{ title: t("costTitle") }} />
        <Stack.Screen name="admin-quality" options={{ title: t("qualityTitle") }} />
        <Stack.Screen name="compose" options={{ title: t("newPost"), presentation: "modal" }} />
        <Stack.Screen name="tag/[tag]" options={{ title: "" }} />
        <Stack.Screen name="b/[handle]" options={{ title: "" }} />
        <Stack.Screen name="sessions" options={{ title: t("sessionsTitle") }} />
        <Stack.Screen name="mfa" options={{ title: t("mfaTitle"), presentation: "modal" }} />
        <Stack.Screen name="about" options={{ title: t("aboutTitle") }} />
        <Stack.Screen name="my-businesses" options={{ title: t("myBusinesses") }} />
        <Stack.Screen name="business-edit" options={{ title: t("businessProfile"), presentation: "modal" }} />
        <Stack.Screen name="flag" options={{ title: t("flag"), presentation: "modal" }} />
        <Stack.Screen name="moderation/index" options={{ title: t("moderation") }} />
        <Stack.Screen name="moderation/[id]" options={{ title: t("moderation") }} />
        <Stack.Screen name="moderation/event/[id]" options={{ title: t("eventTools") }} />
        <Stack.Screen name="my-moderation" options={{ title: t("myModeration") }} />
        <Stack.Screen name="my-reports" options={{ title: t("myReports") }} />
        <Stack.Screen name="following" options={{ title: t("followingTitle") }} />
        <Stack.Screen name="blocked" options={{ title: t("blockedTitle") }} />
        <Stack.Screen name="admin-businesses" options={{ title: t("adminBusinesses") }} />
        <Stack.Screen name="admin-presence" options={{ title: t("presenceLogTitle") }} />
        <Stack.Screen name="delete-account" options={{ title: t("deleteAccount") }} />
        <Stack.Screen name="age-check" options={{ title: t("ageTitle"), presentation: "modal" }} />
        <Stack.Screen name="profile-edit" options={{ title: t("editProfile") }} />
        <Stack.Screen name="zone-edit" options={{ title: t("addZone") }} />
        <Stack.Screen name="language" options={{ title: t("language"), presentation: "modal" }} />
      </Stack>
      <NotificationRouting />
      <AgeGate />
    </SessionProvider>
  );
}

/** Abre el EVENT al tocar un aviso; espera a la sesión para que la pantalla pueda cargarlo. */
function NotificationRouting() {
  useNotificationRouting(useSession().ready);
  return null;
}

/** Edad mínima (ADR 0049): si la cuenta aún no la declaró, se pide una vez por arranque (salvo menores ya avisados). */
function AgeGate() {
  const { ready } = useSession();
  useEffect(() => {
    if (!ready) return;
    Promise.all([api.account(), isAgeBlocked()])
      .then(([a, blocked]) => { if (!a.ageConfirmed && !blocked) router.push("/age-check"); })
      .catch(() => undefined);
  }, [ready]);
  return null;
}
