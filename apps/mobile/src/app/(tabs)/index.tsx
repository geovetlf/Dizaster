import type { CategoryCatalog, FeedTab } from "@dizaster/contracts";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FeedList } from "../../components/feed-list";
import { CategoryGrid } from "../../components/home/category-grid";
import { HomeHeader } from "../../components/home/header";
import { MapPreview } from "../../components/home/map-preview";
import { t } from "../../lib/i18n";
import { homeChips, MORE_CODE, type CategoryChip } from "../../lib/ui/categories";
import { useCoarseLocation } from "../../lib/ui/use-coarse-location";
import { colors, radius, space } from "../../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../../reference-data/categories.json") as CategoryCatalog;
const { chips, more } = homeChips(catalog);
const TABS: { tab: FeedTab; label: () => string }[] = [
  { tab: "for_you", label: () => t("forYou") },
  { tab: "nearby", label: () => t("nearbyTab") },
  { tab: "following", label: () => t("following") },
];

/** Inicio (referencia: docs/design/referencia-inicio.jpg). */
export default function HomeScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [showMore, setShowMore] = useState(false);
  const [tab, setTab] = useState<FeedTab>("for_you");
  const location = useCoarseLocation();

  const select = (c: CategoryChip) => {
    if (c.code === MORE_CODE) return setShowMore((v) => !v);
    setCategory(c.code);
  };
  const moreSelected = more.some((m) => m.code === category);

  const header = useMemo(
    () => (
      <View>
        <HomeHeader />
        <CategoryGrid chips={chips} selected={moreSelected ? MORE_CODE : category} onSelect={select} />
        {showMore || moreSelected ? <CategoryGrid chips={more} selected={category} onSelect={select} /> : null}
        <MapPreview center={location.point} category={category} onLocate={() => void location.request()} />
        <View style={styles.feedHead}>
          <Text style={styles.feedTitle}>{t("recentPosts")}</Text>
          <View style={styles.tabs}>
            {TABS.map((x) => (
              <Pressable key={x.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === x.tab }} onPress={() => setTab(x.tab)} style={[styles.tab, tab === x.tab && styles.tabActive]}>
                <Text style={[styles.tabText, tab === x.tab && styles.tabTextActive]}>{x.label()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    ),
    [category, showMore, tab, location.point],
  );

  const empty =
    tab === "following" ? (
      <View style={styles.notice}><Text style={styles.noticeText}>{t("followingEmpty")}</Text></View>
    ) : tab === "nearby" && !location.point ? (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{t("nearbyNeedsLocation")}</Text>
        <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => void location.request()}>
          <Text style={styles.noticeButtonText}>{t("enableLocation")}</Text>
        </Pressable>
      </View>
    ) : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FeedList tab={tab} category={category} near={tab === "nearby" ? location.point : null} header={header} {...(empty ? { empty } : {})} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, paddingTop: space.md },
  feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xl, marginBottom: space.md, flexWrap: "wrap", gap: space.sm },
  feedTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: space.md },
  tab: { paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.textMuted, fontSize: 14 },
  tabTextActive: { color: colors.accent, fontWeight: "600" },
  notice: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, alignItems: "center", gap: space.md },
  noticeText: { color: colors.textMuted, textAlign: "center" },
  noticeButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, paddingVertical: 10 },
  noticeButtonText: { color: colors.white, fontWeight: "600" },
});
