import { MAX_BUSINESSES_PER_USER, type BusinessView } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { BUSINESS_CATEGORY_LABEL, verificationIcon } from "../lib/social/business";
import { colors, radius, space } from "../theme";

/** Negocios que administro (máximo 3 en V1) y botón para crear uno. */
export default function MyBusinessesScreen() {
  const [list, setList] = useState<BusinessView[] | null>(null);
  useFocusEffect(useCallback(() => { api.myBusinesses().then((r) => setList(r.businesses)).catch(() => setList([])); }, []));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {list?.map((b) => {
        const badge = verificationIcon(b.verification);
        return (
          <Pressable key={b.handle} accessibilityRole="link" style={styles.row} onPress={() => router.push(`/b/${b.handle}`)}>
            <Icon name="storefront-outline" size={24} color={colors.text} />
            <View style={styles.body}>
              <Text style={styles.name}>{b.name} {badge ? <Icon name={badge} size={14} color={colors.link} /> : null}</Text>
              <Text style={styles.meta}>@{b.handle} · {BUSINESS_CATEGORY_LABEL[b.category][lang]} · {b.followerCount} {t("followers")}</Text>
            </View>
          </Pressable>
        );
      })}
      {list && list.length === 0 ? <Text style={styles.meta}>{t("noBusinesses")}</Text> : null}
      {list && list.length < MAX_BUSINESSES_PER_USER ? (
        <Pressable accessibilityRole="button" style={styles.create} onPress={() => router.push("/business-edit")}>
          <Text style={styles.createText}>{t("createBusiness")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.note}>{t("businessNote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  body: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  create: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center", marginTop: space.md },
  createText: { color: colors.white, fontWeight: "700" },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.md },
});
