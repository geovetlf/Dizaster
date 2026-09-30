import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "../lib/api";
import { isEmail, normalizeCode } from "../lib/auth/sign-in-flow";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/** Métodos de inicio de sesión de la cuenta y vincular un correo (ADR 0171): así no se pierde la cuenta al cambiar de teléfono. */
export default function SignInMethodsScreen() {
  const [providers, setProviders] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => { api.myIdentities().then((r) => setProviders(r.providers)).catch((e: Error) => setMessage(e.message)); }, []);
  useFocusEffect(load);

  async function send() {
    if (!isEmail(email)) return setMessage(t("signInBadEmail"));
    try { await api.emailStart(email); setSent(true); setMessage(t("signInCodeSent")); } catch (e) { setMessage((e as Error).message); }
  }
  async function link() {
    const c = normalizeCode(code);
    if (!c) return setMessage(t("signInBadCode"));
    try { await api.linkEmail(email, c); setSent(false); setCode(""); setEmail(""); setMessage(t("methodLinked")); load(); } catch (e) { setMessage((e as Error).message); }
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.body}>{t("methodsHint")}</Text>
      {providers.filter((p) => p !== "DEV").map((p) => <Text key={p} style={styles.item}>✓ {t(`method_${p}` as "method_EMAIL")}</Text>)}
      {!providers.includes("EMAIL") ? (
        <>
          <Text style={styles.section}>{t("methodAddEmail")}</Text>
          <TextInput accessibilityLabel={t("signInEmail")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" maxLength={254}
            placeholder={t("signInEmail")} placeholderTextColor={colors.textMuted} style={styles.input} />
          {sent ? (
            <TextInput accessibilityLabel={t("signInCodeLabel")} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={9} placeholder="123456" placeholderTextColor={colors.textMuted} style={styles.input} />
          ) : null}
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void (sent ? link() : send())}>
            <Text style={styles.buttonText}>{t(sent ? "methodLink" : "signInSendCode")}</Text>
          </Pressable>
        </>
      ) : null}
      {message ? <Text style={styles.body}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  body: { color: colors.textMuted },
  item: { color: colors.text, fontSize: 16 },
  section: { color: colors.text, fontWeight: "700", marginTop: space.md },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  buttonText: { color: colors.white, fontWeight: "700" },
});
