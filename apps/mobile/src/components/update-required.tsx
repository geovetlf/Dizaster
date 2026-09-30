import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { appPlatform, appVersion } from "../lib/app-identity";
import { updateRequirement } from "../lib/app-update";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/** Versión por debajo de la mínima (ADR 0164): `null` mientras no se sabe (se deja usar). */
export function useUpdateRequirement(): { required: boolean; storeUrl: string | null } {
  const [req, setReq] = useState({ required: false, storeUrl: null as string | null });
  useEffect(() => {
    api.config().then((c) => setReq(updateRequirement(c, appPlatform, appVersion))).catch(() => undefined);
  }, []);
  return req;
}

/** Aviso que reemplaza el formulario: actualizar, y emergencias siempre a mano. */
export function UpdateRequired({ storeUrl }: { storeUrl: string | null }) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("updateRequiredTitle")}</Text>
      <Text style={styles.body}>{t("updateRequiredBody")}</Text>
      {storeUrl ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => void Linking.openURL(storeUrl)}>
          <Text style={styles.buttonText}>{t("updateApp")}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => router.push("/emergency")}>
        <Text style={styles.link}>{t("emergencyTitle")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm, margin: space.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.textMuted },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  buttonText: { color: colors.white, fontWeight: "700" },
  link: { color: colors.link, paddingVertical: space.xs },
});
