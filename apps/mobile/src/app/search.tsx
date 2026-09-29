import type { AreaSearchResult, CategoryCatalog } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { categoryStyle } from "../lib/ui/categories";
import { areaRow, bboxParam } from "../lib/ui/format";
import { useCoarseLocation } from "../lib/ui/use-coarse-location";
import { colors, radius, space } from "../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Row = { type: "area"; area: AreaSearchResult } | { type: "category"; code: string; name: string };

/**
 * Búsqueda: lugares (índice geográfico propio, sin geocodificador comercial) y categorías (catálogo
 * empaquetado, funciona sin conexión). Usuarios: con los perfiles públicos (siguiente etapa).
 */
export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [areas, setAreas] = useState<AreaSearchResult[]>([]);
  const location = useCoarseLocation();
  const near = location.point;

  const categories = useMemo(() => {
    const n = normalize(q.trim());
    return catalog.categories.filter((c) => !n || Object.values(c.names).some((name) => normalize(name).includes(n)));
  }, [q]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setAreas([]); return; }
    let live = true;
    // Espera a que el usuario deje de escribir: menos peticiones, menos coste.
    const timer = setTimeout(() => {
      api.areas(text, near).then((r) => { if (live) setAreas(r.areas); }).catch(() => { if (live) setAreas([]); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, near]);

  const sections = [
    ...(areas.length ? [{ title: t("searchPlaces"), data: areas.map((area): Row => ({ type: "area", area })) }] : []),
    {
      title: t("searchCategories"),
      data: categories.map((c): Row => ({ type: "category", code: c.code, name: c.names[lang] ?? c.names["es"] ?? c.code })),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        <Icon name="magnify" size={22} color={colors.textMuted} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t("searchPlaceholder")} placeholderTextColor={colors.textMuted} style={styles.input} />
      </View>
      <SectionList
        sections={sections}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(r) => (r.type === "area" ? r.area.id : r.code)}
        renderSectionHeader={({ section }) => <Text style={styles.note}>{section.title}</Text>}
        ListFooterComponent={<Text style={styles.note}>{t("searchUsersSoon")}</Text>}
        renderItem={({ item }) => {
          if (item.type === "area") {
            const row = areaRow(item.area);
            return (
              <Pressable
                accessibilityRole="button"
                style={styles.row}
                onPress={() => { router.dismissTo({ pathname: "/map", params: { bbox: bboxParam(item.area.bbox) } }); }}
              >
                <Icon name="map-marker" size={22} color={colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{row.title}</Text>
                  <Text style={styles.rowSub}>{row.subtitle}</Text>
                </View>
              </Pressable>
            );
          }
          const s = categoryStyle(item.code);
          return (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => { router.dismissTo({ pathname: "/", params: { category: item.code } }); }}>
              <Icon name={s.icon} size={22} color={s.color} />
              <Text style={styles.rowText}>{item.name}</Text>
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
  rowBody: { flex: 1 },
  rowSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
