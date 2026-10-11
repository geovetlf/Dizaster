import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isGuest } from "../lib/auth/guest";
import { t } from "../lib/i18n";
import { useSession } from "../lib/session";
import { colors, radius, space } from "../theme";

/** Sin cuenta (ADR 0317, 0332): la sesión arrancó y no hay con qué entrar. */
export function useIsGuest(): boolean {
  return isGuest(useSession());
}

/**
 * Aviso que reemplaza un formulario de escritura cuando no hay cuenta: qué se puede hacer sin ella, «Entrar» y
 * emergencias a un toque. El servidor sigue rechazando la escritura con 401: esto no es la única barrera.
 */
export function AccountRequired() {
  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={styles.title}>{t("accountRequiredTitle")}</Text>
      <Text style={styles.body}>{t("accountRequiredBody")}</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push("/sign-in")}>
        <Text style={styles.buttonText}>{t("signInAction")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.linkTarget} onPress={() => router.push("/emergency")}>
        <Text style={styles.link}>{t("emergencyTitle")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm, margin: space.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.textMuted },
  // Mínimo 44 de alto para el dedo (ADR 0240).
  button: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg },
  buttonText: { color: colors.white, fontWeight: "700" },
  linkTarget: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  link: { color: colors.link },
});
