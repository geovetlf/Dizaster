import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { t } from "../lib/i18n";
import { useNotificationRouting } from "../lib/alerts/notifications";
import { SessionProvider, useSession } from "../lib/session";
import { colors } from "../theme";

const header = { headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerTitleAlign: "center" as const, contentStyle: { backgroundColor: colors.bg } };

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack screenOptions={header}>
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
        <Stack.Screen name="flag" options={{ title: t("flag"), presentation: "modal" }} />
        <Stack.Screen name="moderation/index" options={{ title: t("moderation") }} />
        <Stack.Screen name="moderation/[id]" options={{ title: t("moderation") }} />
        <Stack.Screen name="my-moderation" options={{ title: t("myModeration") }} />
        <Stack.Screen name="delete-account" options={{ title: t("deleteAccount") }} />
      </Stack>
      <NotificationRouting />
    </SessionProvider>
  );
}

/** Abre el EVENT al tocar un aviso; espera a la sesión para que la pantalla pueda cargarlo. */
function NotificationRouting() {
  useNotificationRouting(useSession().ready);
  return null;
}
