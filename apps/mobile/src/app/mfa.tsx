import type { MfaEnrollResponse, MfaStatus } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { cleanTotp, groupSecret } from "../lib/auth/mfa";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

/**
 * Verificación en dos pasos del personal (ADR 0090): alta con cualquier app de autenticación (TOTP), códigos de
 * recuperación mostrados una sola vez, y verificación de la sesión cuando moderación la pide.
 */
export default function MfaScreen() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enroll, setEnroll] = useState<MfaEnrollResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.mfaStatus().then(setStatus).catch((e: Error) => setError(e.message)); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const start = () => run(async () => { setEnroll(await api.mfaEnroll()); });
  const confirm = () => run(async () => { setRecovery((await api.mfaConfirm(code)).recoveryCodes); setCode(""); });
  const verify = () => run(async () => {
    await api.mfaVerify(recoveryMode ? { recoveryCode: code.trim() } : { code });
    router.back();
  });
  // Quitar el autenticador (ADR 0098): pide un código vigente; con MFA obligatoria habrá que volver a darlo de alta.
  const disable = () => Alert.alert(t("mfaDisable"), t("mfaDisableConfirm"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("mfaDisable"), style: "destructive", onPress: () => void run(async () => { await api.mfaDisable(code); setCode(""); setStatus(await api.mfaStatus()); }) },
  ]);

  if (recovery) {
    return (
      <ScrollView automaticallyAdjustKeyboardInsets style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.text}>{t("mfaRecoveryTitle")}</Text>
        {recovery.map((c) => <Text key={c} selectable style={styles.mono}>{c}</Text>)}
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.back()}>
          <Text style={styles.primaryText}>{t("mfaSaved")}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const valid = recoveryMode ? code.trim().length >= 8 : code.length === 6;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.text}>{t("mfaIntro")}</Text>
      {status && !status.enrolled && !enroll ? (
        <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => void start()}>
          <Text style={styles.primaryText}>{t("mfaSetup")}</Text>
        </Pressable>
      ) : null}
      {enroll ? (
        <View style={styles.box}>
          <Text style={styles.label}>{t("mfaSecret")}</Text>
          <Text selectable style={styles.mono}>{groupSecret(enroll.secret)}</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(enroll.otpauthUri).catch(() => undefined)}>
            <Text style={styles.link}>{t("mfaOpenApp")}</Text>
          </Pressable>
        </View>
      ) : null}
      {status?.enrolled || enroll ? (
        <>
          <TextInput accessibilityLabel={recoveryMode ? t("mfaRecoveryCode") : t("mfaCode")}
            value={code}
            onChangeText={(v) => setCode(recoveryMode ? v : cleanTotp(v))}
            keyboardType={recoveryMode ? "default" : "number-pad"}
            autoCapitalize="characters"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder={recoveryMode ? t("mfaRecoveryCode") : t("mfaCode")}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Pressable accessibilityRole="button" disabled={!valid || busy} style={[styles.primary, (!valid || busy) && styles.disabled]}
            onPress={() => void (enroll ? confirm() : verify())}>
            <Text style={styles.primaryText}>{enroll ? t("mfaConfirm") : t("mfaVerify")}</Text>
          </Pressable>
          {status?.enrolled ? (
            <Pressable accessibilityRole="button" onPress={() => { setRecoveryMode(!recoveryMode); setCode(""); }}>
              <Text style={styles.link}>{recoveryMode ? t("mfaCode") : t("mfaUseRecovery")}</Text>
            </Pressable>
          ) : null}
          {status?.enrolled && !enroll && !recoveryMode ? (
            <Pressable accessibilityRole="button" disabled={!valid || busy} onPress={disable}>
              <Text style={[styles.link, (!valid || busy) && styles.disabled]}>{t("mfaDisable")}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  text: { color: colors.text, fontSize: 15 },
  label: { color: colors.textMuted, fontSize: 13 },
  mono: { color: colors.text, fontFamily: "monospace", fontSize: 18, letterSpacing: 1 },
  box: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.sm },
  link: { color: colors.accentText, fontWeight: "600" },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, fontSize: 20, letterSpacing: 4 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center" },
  primaryText: { color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  error: { color: colors.accentText },
});
