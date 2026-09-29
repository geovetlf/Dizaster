import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../../lib/i18n";
import { colors, radius, space } from "../../theme";
import { Icon } from "../icon";

/**
 * Cabecera del inicio. Además de lo que muestra la referencia (buscar, alertas, perfil) incluye un acceso
 * SOS a los números de emergencia: en una app de seguridad debe estar a un toque desde la primera pantalla.
 */
export function HomeHeader() {
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.brand}>
          <Text style={styles.logo} accessibilityRole="header">
            DIZ<Text style={styles.logoA}>A</Text>STER
          </Text>
          <Text style={styles.tagline}>{t("tagline")}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("emergency")} style={[styles.iconButton, styles.sos]} onPress={() => router.push("/emergency")}>
          <Text style={styles.sosText}>SOS</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("alerts")} style={styles.iconButton} onPress={() => router.push("/profile")}>
          <Icon name="bell-outline" size={24} color={colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("profile")} style={styles.iconButton} onPress={() => router.push("/profile")}>
          <Icon name="account-circle-outline" size={26} color={colors.text} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="search" style={styles.search} onPress={() => router.push("/search")}>
        <Icon name="magnify" size={22} color={colors.textMuted} />
        <Text style={styles.searchText}>{t("searchPlaceholder")}</Text>
        <Icon name="tune-variant" size={22} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  brand: { flex: 1 },
  logo: { color: colors.white, fontSize: 32, fontWeight: "900", letterSpacing: 0.5 },
  logoA: { color: colors.accent },
  tagline: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  iconButton: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  sos: { backgroundColor: colors.accent, borderColor: colors.accent },
  sosText: { color: colors.white, fontWeight: "800", fontSize: 13 },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.lg, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  searchText: { flex: 1, color: colors.textMuted, fontSize: 15 },
});
