import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { lang, locale, t } from "../lib/i18n";
import { LANGUAGE_NAMES, LANGUAGE_OPTIONS, resolveLang, type LanguagePref } from "../lib/language";
import { chooseLanguage, loadLanguagePref } from "../lib/language-store";
import { colors, space } from "../theme";

/** Idioma de la app (ADR 0069). Cada opción se nombra en su propio idioma. */
export default function LanguageScreen() {
  const [current] = useState<LanguagePref>(() => loadLanguagePref());

  function pick(pref: LanguagePref) {
    const next = resolveLang(pref, locale);
    // Los avisos push también llegan en el idioma elegido (preferencias del servidor).
    if (next !== lang) api.updateAlertPreferences({ lang: next }).catch(() => undefined);
    router.back();
    chooseLanguage(pref);
  }

  return (
    <View style={styles.container}>
      {LANGUAGE_OPTIONS.map((o) => (
        <Pressable key={o} accessibilityRole="radio" accessibilityState={{ checked: o === current }} style={styles.row} onPress={() => pick(o)}>
          <Text style={styles.label}>{o === "system" ? `${t("languageSystem")} (${LANGUAGE_NAMES[resolveLang("system", locale)]})` : LANGUAGE_NAMES[o]}</Text>
          {o === current ? <Icon name="check" size={22} color={colors.accent} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 16 },
});
