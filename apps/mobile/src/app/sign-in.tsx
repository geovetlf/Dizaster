import type { AuthProviders } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "../lib/api";
import { isEmail, normalizeCode } from "../lib/auth/sign-in-flow";
import { hardwareId } from "../lib/device/hardware-id";
import { t } from "../lib/i18n";
import { useSession } from "../lib/session";
import { colors, radius, space } from "../theme";
import { appConfig } from "../lib/config/app-config";

/**
 * Iniciar sesión (§5.1, D-11, ADR 0171). Correo con código de 6 dígitos; Apple y Google se agregan cuando el
 * servidor los anuncia y existan las credenciales del propietario. Emergencias siempre a un toque, sin cuenta.
 */
export default function SignInScreen() {
  const session = useSession();
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    appConfig().then((c) => setProviders(c.authProviders ?? null)).catch(() => setProviders(null));
  }, []);

  async function send() {
    if (!isEmail(email)) return setMessage(t("signInBadEmail"));
    setBusy(true);
    try {
      await api.emailStart(email);
      setStep("code");
      setMessage(t("signInCodeSent"));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const c = normalizeCode(code);
    if (!c) return setMessage(t("signInBadCode"));
    setBusy(true);
    try {
      const pair = await api.emailVerify(email, c, Platform.OS === "ios" ? "IOS" : "ANDROID", session.deviceId, await hardwareId());
      await session.completeSignIn(pair);
      if (router.canGoBack()) router.back();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const emailOff = providers !== null && !providers.email;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>{t("signInTitle")}</Text>
      <Text style={styles.body}>{t("signInBody")}</Text>
      {emailOff ? <Text style={styles.body}>{t("signInUnavailable")}</Text> : step === "email" ? (
        <>
          <TextInput accessibilityLabel={t("signInEmail")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
            maxLength={254} placeholder={t("signInEmail")} placeholderTextColor={colors.textMuted} style={styles.input} />
          <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void send()}>
            <Text style={styles.buttonText}>{t("signInSendCode")}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput accessibilityLabel={t("signInCodeLabel")} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode"
            maxLength={9} placeholder="123456" placeholderTextColor={colors.textMuted} style={styles.input} />
          <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void verify()}>
            <Text style={styles.buttonText}>{t("signInEnter")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setStep("email"); setCode(""); setMessage(null); }}>
            <Text style={styles.link}>{t("signInOtherEmail")}</Text>
          </Pressable>
        </>
      )}
      {message ? <Text style={styles.body}>{message}</Text> : null}
      <Pressable accessibilityRole="button" style={styles.emergency} onPress={() => router.push("/emergency")}>
        <Text style={styles.emergencyText}>{t("emergencyTitle")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: space.lg, gap: space.md },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  body: { color: colors.textMuted },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 16 },
  button: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center" },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: "700" },
  link: { color: colors.link, paddingVertical: space.xs },
  emergency: { marginTop: "auto", borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center" },
  emergencyText: { color: colors.accentText, fontWeight: "700" },
});
