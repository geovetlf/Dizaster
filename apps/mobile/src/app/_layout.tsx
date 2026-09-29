import { Stack } from "expo-router";
import { SessionProvider } from "../lib/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerTitleAlign: "center" }}>
        <Stack.Screen name="index" options={{ title: "Dizaster" }} />
        <Stack.Screen name="report" options={{ title: "Reportar", presentation: "modal" }} />
        <Stack.Screen name="emergency" options={{ title: "Emergencia", presentation: "modal" }} />
        <Stack.Screen name="event/[id]" options={{ title: "Evento" }} />
      </Stack>
    </SessionProvider>
  );
}
