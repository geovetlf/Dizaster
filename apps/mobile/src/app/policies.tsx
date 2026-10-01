import type { PolicyDocumentStatus } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { acceptBody, isUpdate, pendingPolicies } from "../lib/account/policies";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";
import { ErrorText } from "../components/error-text";

/**
 * Aceptar términos y políticas (ADR 0176). Cada documento se abre en el navegador; se acepta la versión mostrada.
 * Sin aceptar, la app sigue sirviendo para ver y para emergencias; publicar e interactuar esperan.
 */
export default function PoliciesScreen() {
  const [docs, setDocs] = useState<PolicyDocumentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.policies().then((s) => setDocs(pendingPolicies(s))).catch((e: Error) => setError(e.message));
  }, []);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptPolicies(acceptBody(docs));
      router.back();
    } catch (e) {
      // Una versión nueva publicada mientras tanto: se recarga para aceptar la vigente.
      if ((e as { status?: number }).status === 409) api.policies().then((s) => setDocs(pendingPolicies(s))).catch(() => undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("policiesTitle")}</Text>
      <Text style={styles.body}>{t("policiesBody")}</Text>
      {docs.map((d) => (
        <Pressable key={d.kind} accessibilityRole="link" style={styles.doc} onPress={() => void Linking.openURL(d.url)}>
          <Text style={styles.docTitle}>{t(`policy_${d.kind}`)}</Text>
          <Text style={styles.meta}>{isUpdate(d) ? t("policyUpdated") : t("policyNew")} · {d.version}{d.required ? "" : ` · ${t("policyOptional")}`}</Text>
        </Pressable>
      ))}
      {error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || docs.length === 0 }} disabled={busy || docs.length === 0}
        style={[styles.primary, (busy || docs.length === 0) && styles.disabled]} onPress={() => void accept()}>
        <Text style={styles.primaryText}>{t("policiesAccept")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.back()}>
        <Text style={styles.meta}>{t("policiesLater")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  doc: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  docTitle: { color: colors.link, fontWeight: "700" },
  meta: { color: colors.textMuted },
  error: { color: colors.like },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: space.lg },
  primaryText: { color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  secondary: { paddingVertical: 14, alignItems: "center" },
});
