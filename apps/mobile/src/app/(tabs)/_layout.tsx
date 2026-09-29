import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/icon";
import { t } from "../../lib/i18n";
import { colors } from "../../theme";

/** Barra inferior: Inicio, Mapa, Reportar (botón central), Videos, Perfil. Igual en Android e iOS. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 72, paddingTop: 6 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.text,
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("home"), tabBarIcon: ({ color }) => <Icon name="home" size={26} color={color} /> }} />
      <Tabs.Screen name="map" options={{ title: t("map"), tabBarIcon: ({ color }) => <Icon name="map-legend" size={26} color={color} /> }} />
      <Tabs.Screen
        name="new"
        options={{
          title: t("report"),
          // El botón central abre el flujo de reporte como modal en lugar de cambiar de pestaña.
          tabBarButton: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={t("report")} style={styles.fabSlot} onPress={() => router.push("/report")}>
              <View style={styles.fab}><Icon name="plus" size={34} color={colors.white} /></View>
              <Text style={styles.fabLabel}>{t("report")}</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="videos" options={{ title: t("videos"), tabBarIcon: ({ color }) => <Icon name="video" size={26} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: t("profile"), tabBarIcon: ({ color }) => <Icon name="account" size={26} color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabSlot: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 6 },
  fab: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: -30, borderWidth: 4, borderColor: colors.bg },
  fabLabel: { color: colors.text, fontSize: 12, fontWeight: "600", marginTop: 2 },
});
