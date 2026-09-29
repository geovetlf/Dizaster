import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { t } from "../lib/i18n";
import { SessionProvider } from "../lib/session";
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
      </Stack>
    </SessionProvider>
  );
}
