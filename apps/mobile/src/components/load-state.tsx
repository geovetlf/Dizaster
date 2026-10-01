import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../lib/i18n";
import type { LoadErrorKind } from "../lib/errors/load-error";
import { colors, radius, space } from "../theme";

/**
 * Estados de carga compartidos (ADR 0212): cargando, no encontrado (enlace roto o contenido borrado) y error con
 * reintento. Traducidos y accesibles; nunca muestra el mensaje técnico.
 */
export function LoadState({ state, onRetry }: { state: "loading" | LoadErrorKind; onRetry?: () => void }) {
  if (state === "loading") {
    return (
      <View style={styles.box} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.text} accessibilityLabel={t("loading")} />
      </View>
    );
  }
  if (state === "notFound") return <NotFound />;
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      {/* Sin respuesta: revisar la conexión. Con respuesta de error: el problema no es la red del teléfono (ADR 0292). */}
      <Text style={styles.body}>{t(state === "offline" ? "loadError" : "loadFailed")}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>{t("retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function NotFound() {
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">{t("notFoundTitle")}</Text>
      <Text style={styles.body}>{t("notFoundBody")}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/")} style={styles.button}>
        <Text style={styles.buttonText}>{t("goHome")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg, gap: space.md, backgroundColor: colors.bg, minHeight: 200 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  body: { color: colors.textMuted, textAlign: "center" },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: space.lg },
  buttonText: { color: colors.white, fontWeight: "700" },
});
