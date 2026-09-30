import type { ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { recordError } from "../lib/errors/error-store";
import { t } from "../lib/i18n";
import { colors } from "../theme";
import { EmergencyNumbers } from "./emergency-numbers";

/**
 * Pantalla de error global (§5.22, ADR 0161). Reemplaza a la navegación cuando algo falla, así que no depende de
 * ella ni de la sesión: los números de emergencia salen del dataset local y se llaman directo desde aquí.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { recordError(error, "ErrorBoundary"); }, [error]);
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{t("crashTitle")}</Text>
      <Text style={styles.body}>{t("crashBody")}</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => void retry()}>
        <Text style={styles.buttonText}>{t("retry")}</Text>
      </Pressable>
      <EmergencyNumbers compact />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56, paddingHorizontal: 16, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: 8 },
  body: { color: colors.textMuted, marginBottom: 12 },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginBottom: 16 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
