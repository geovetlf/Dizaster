import type { BusinessVerification, BusinessView, OfficialScopeView } from "@dizaster/contracts";
import { useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseScopeList } from "../lib/admin/admin-tools";
import { validReason } from "../lib/admin/sources-format";
import { api } from "../lib/api";
import { t, type MessageKey } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const LEVELS: BusinessVerification[] = ["UNVERIFIED", "VERIFIED", "INSTITUTIONAL_OFFICIAL"];
const LEVEL_LABEL: Record<BusinessVerification, MessageKey> = {
  UNVERIFIED: "bizUnverified", VERIFIED: "bizVerified", INSTITUTIONAL_OFFICIAL: "bizInstitutional",
};

/** Sello de negocios e instituciones y ámbito oficial (ADR 0095, ADR 0098). Solo administración. */
export default function AdminBusinessesScreen() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<BusinessView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function search() {
    try {
      setResults((await api.searchBusinesses(q.trim())).businesses);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      data={results}
      keyExtractor={(b) => b.handle}
      ListHeaderComponent={
        <View style={styles.search}>
          <TextInput accessibilityLabel={t("bizSearch")} value={q} onChangeText={setQ} onSubmitEditing={() => void search()} placeholder={t("bizSearch")} placeholderTextColor={colors.textMuted}
            autoCapitalize="none" returnKeyType="search" style={styles.input} />
          <TextInput accessibilityLabel={t("actionReason")} value={reason} onChangeText={setReason} maxLength={500} placeholder={t("actionReason")} placeholderTextColor={colors.textMuted} style={styles.input} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      renderItem={({ item }) => <BusinessAdminRow business={item} reason={reason.trim()} onChange={(b) => setResults((prev) => prev.map((x) => (x.handle === b.handle ? b : x)))} />}
    />
  );
}

function BusinessAdminRow({ business, reason, onChange }: { business: BusinessView; reason: string; onChange: (b: BusinessView) => void }) {
  const reasonOk = validReason(reason);
  const [scope, setScope] = useState<OfficialScopeView | null>(null);
  const [categories, setCategories] = useState("");
  const [countries, setCountries] = useState(business.country ?? "");
  const [error, setError] = useState<string | null>(null);
  const cats = parseScopeList(categories, "category");
  const ctry = parseScopeList(countries, "country");
  const scopeOk = reasonOk && cats.values.length > 0 && ctry.values.length > 0 && cats.invalid.length === 0 && ctry.invalid.length === 0;

  function setLevel(v: BusinessVerification) {
    Alert.alert(`@${business.handle}`, `${t("bizConfirmLevel")} ${t(LEVEL_LABEL[v])}`, [
      { text: t("cancel"), style: "cancel" },
      { text: t("apply"), onPress: () => void api.setBusinessVerification(business.handle, v, reason).then((b) => { onChange(b); setScope(null); }).catch((e: Error) => setError(e.message)) },
    ]);
  }
  function saveScope() {
    Alert.alert(`@${business.handle}`, t("bizConfirmScope"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("apply"), onPress: () => void api.setOfficialScope(business.handle, cats.values, ctry.values, reason).then(setScope).catch((e: Error) => setError(e.message)) },
    ]);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{business.name} · @{business.handle}</Text>
      <View style={styles.chips}>
        {LEVELS.map((v) => (
          <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: business.verification === v, disabled: !reasonOk }} disabled={business.verification === v || !reasonOk}
            style={[styles.chip, business.verification === v && styles.chipOn, !reasonOk && business.verification !== v && styles.disabled]} onPress={() => setLevel(v)}>
            <Text style={styles.chipText}>{t(LEVEL_LABEL[v])}</Text>
          </Pressable>
        ))}
      </View>
      {business.verification === "INSTITUTIONAL_OFFICIAL" ? (
        <View style={styles.scope}>
          <Text style={styles.meta}>{t("bizScopeHint")}</Text>
          <TextInput accessibilityLabel={t("bizScopeCategories")} value={categories} onChangeText={setCategories} placeholder={t("bizScopeCategories")} placeholderTextColor={colors.textMuted} autoCapitalize="none" style={styles.input} />
          <TextInput accessibilityLabel={t("bizScopeCountries")} value={countries} onChangeText={setCountries} placeholder={t("bizScopeCountries")} placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={styles.input} />
          {[...cats.invalid, ...ctry.invalid].length ? <Text style={styles.error}>{t("bizScopeInvalid")}: {[...cats.invalid, ...ctry.invalid].join(", ")}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!scopeOk} style={[styles.save, !scopeOk && styles.disabled]} onPress={saveScope}>
            <Text style={styles.chipText}>{t("apply")}</Text>
          </Pressable>
          {scope ? <Text style={styles.meta}>✓ {scope.categories.join(", ")} · {scope.countries.join(", ")}</Text> : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  search: { gap: space.sm, marginBottom: space.sm },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.sm },
  title: { color: colors.text, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  scope: { gap: space.sm },
  save: { backgroundColor: colors.accent, borderRadius: radius.md, padding: space.sm, alignItems: "center" },
  disabled: { opacity: 0.4 },
  meta: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.accentText, fontSize: 13 },
});
