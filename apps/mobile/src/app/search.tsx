import type { CategoryCatalog } from "@dizaster/contracts";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { lang, t } from "../lib/i18n";
import { categoryStyle } from "../lib/ui/categories";
import { colors, radius, space } from "../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Búsqueda. Por ahora busca categorías (funciona sin conexión, sobre el catálogo empaquetado).
 * Lugares y usuarios necesitan el índice de lugares y perfiles públicos (siguiente etapa).
 */
export default function SearchScreen() {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const n = normalize(q.trim());
    return catalog.categories.filter((c) => !n || Object.values(c.names).some((name) => normalize(name).includes(n)));
  }, [q]);

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        <Icon name="magnify" size={22} color={colors.textMuted} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t("searchPlaceholder")} placeholderTextColor={colors.textMuted} style={styles.input} />
      </View>
      <Text style={styles.note}>{t("searchSoon")}</Text>
      <FlatList
        data={results}
        keyExtractor={(c) => c.code}
        renderItem={({ item }) => {
          const s = categoryStyle(item.code);
          return (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => { router.dismissTo({ pathname: "/", params: { category: item.code } }); }}>
              <Icon name={s.icon} size={22} color={s.color} />
              <Text style={styles.rowText}>{item.names[lang] ?? item.names["es"]}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  box: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.lg },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  note: { color: colors.textMuted, marginVertical: space.md, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { color: colors.text, fontSize: 16 },
});
