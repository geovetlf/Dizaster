import { BUSINESS_CATEGORIES, CreateBusinessRequest, UpdateBusinessRequest, type BusinessCategory } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AvatarPicker } from "../components/avatar-picker";
import { api } from "../lib/api";
import { lang, t, type MessageKey } from "../lib/i18n";
import { BUSINESS_CATEGORY_LABEL } from "../lib/social/business";
import { colors, radius, space } from "../theme";

/** Crear o editar un negocio. El handle solo se elige al crear (luego es fijo para que no se suplante). */
export default function BusinessEditScreen() {
  const { handle } = useLocalSearchParams<{ handle?: string }>();
  const editing = !!handle;
  const [logoUrl, setLogoUrl] = useState<string | null | undefined>(undefined);
  const [f, setF] = useState({ handle: "", name: "", category: "other" as BusinessCategory, description: "", addressPublic: "", contactPhone: "", contactUrl: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    api.business(handle).then((b) => { setLogoUrl(b.logoUrl); setF({
      handle: b.handle, name: b.name, category: b.category, description: b.description ?? "", addressPublic: b.addressPublic ?? "",
      contactPhone: b.contactPhone ?? "", contactUrl: b.contactUrl ?? "",
    }); }).catch((e: Error) => setError(e.message));
  }, [handle]);

  const body = {
    name: f.name, category: f.category, description: f.description, addressPublic: f.addressPublic,
    contactPhone: f.contactPhone.trim() || null, contactUrl: f.contactUrl.trim() || null,
  };
  // Mismas reglas que el servidor: se valida antes de enviar para mostrar el problema al momento.
  const check = editing ? UpdateBusinessRequest.safeParse(body) : CreateBusinessRequest.safeParse({ ...body, handle: f.handle });
  const invalidField = check.success ? null : String(check.error.issues[0]?.path[0] ?? "");

  async function save() {
    if (!check.success) return setError(t(fieldKey(invalidField)));
    setBusy(true);
    setError(null);
    try {
      const b = editing ? await api.updateBusiness(handle!, body as UpdateBusinessRequest) : await api.createBusiness({ ...body, handle: f.handle } as CreateBusinessRequest);
      router.replace(`/b/${b.handle}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert(t("deleteBusiness"), t("deleteBusinessConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("deleteBusiness"), style: "destructive", onPress: () => { api.deleteBusiness(handle!).then(() => router.dismissTo("/my-businesses")).catch((e: Error) => setError(e.message)); } },
    ]);
  }

  const field = (key: keyof typeof f, label: MessageKey, opts: { multiline?: boolean; keyboard?: "phone-pad" | "url"; max: number }) => (
    <View style={styles.field}>
      <Text style={styles.label}>{t(label)}</Text>
      <TextInput
        style={[styles.input, opts.multiline && styles.multiline]}
        value={f[key]}
        onChangeText={(v) => setF({ ...f, [key]: v })}
        multiline={opts.multiline}
        maxLength={opts.max}
        keyboardType={opts.keyboard === "phone-pad" ? "phone-pad" : opts.keyboard === "url" ? "url" : "default"}
        autoCapitalize={key === "handle" || key === "contactUrl" ? "none" : "sentences"}
        accessibilityLabel={t(label)}
      />
    </View>
  );

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* El logo se pone una vez creado el negocio (ADR 0119). */}
      {editing && logoUrl !== undefined ? (
        <AvatarPicker name={f.name} url={logoUrl} square apply={async (id) => (await api.setBusinessLogo(handle!, id)).logoUrl} />
      ) : null}
      {editing ? <Text style={styles.label}>@{f.handle}</Text> : field("handle", "businessHandle", { max: 30 })}
      {field("name", "businessName", { max: 80 })}
      <Text style={styles.label}>{t("businessCategory")}</Text>
      <View style={styles.chips}>
        {BUSINESS_CATEGORIES.map((c) => (
          <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: f.category === c }} style={[styles.chip, f.category === c && styles.chipOn]} onPress={() => setF({ ...f, category: c })}>
            <Text style={styles.chipText}>{BUSINESS_CATEGORY_LABEL[c][lang]}</Text>
          </Pressable>
        ))}
      </View>
      {field("description", "businessDescription", { multiline: true, max: 500 })}
      {field("addressPublic", "businessAddress", { max: 200 })}
      {field("contactPhone", "businessPhone", { keyboard: "phone-pad", max: 30 })}
      {field("contactUrl", "businessUrl", { keyboard: "url", max: 300 })}
      <Text style={styles.note}>{t("businessNote")}</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.save, busy && styles.disabled]} onPress={() => void save()}>
        <Text style={styles.saveText}>{busy ? t("sending") : t("save")}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {editing ? (
        <Pressable accessibilityRole="button" style={styles.delete} onPress={remove}>
          <Text style={styles.deleteText}>{t("deleteBusiness")}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function fieldKey(field: string | null): MessageKey {
  switch (field) {
    case "handle": return "businessHandleInvalid";
    case "name": return "businessNameInvalid";
    case "contactPhone": return "businessPhoneInvalid";
    case "contactUrl": return "businessUrlInvalid";
    default: return "loadError";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  field: { gap: space.xs },
  label: { color: colors.textMuted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, fontSize: 16 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  chipText: { color: colors.text },
  note: { color: colors.textMuted, fontSize: 12 },
  save: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center", marginTop: space.md },
  disabled: { opacity: 0.5 },
  saveText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  error: { color: colors.accentText },
  delete: { alignItems: "center", padding: space.lg },
  deleteText: { color: colors.accentText },
});
