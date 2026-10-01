import type { MyFollows } from "@dizaster/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { lang, t, type MessageKey } from "../lib/i18n";
import { EMPTY_FOLLOWS, followSections, withFollow, type FollowRow } from "../lib/social/follow-state";
import { colors, radius, space } from "../theme";
import { categoryLabel } from "../lib/category-store";
import { ErrorText } from "../components/error-text";

const categoryName = categoryLabel;
const eventName = (e: MyFollows["events"][number]) => e.title?.[lang] ?? (e.title ? Object.values(e.title)[0] : undefined) ?? categoryName(e.categoryCode);
const SECTION: Record<string, MessageKey> = {
  events: "followingEvents", places: "followingPlaces", tags: "followingTags", profiles: "followingPeople", businesses: "followingBusinesses",
};

/** Lo que sigo (ADR 0097): eventos, lugares, etiquetas, personas y negocios, con "Dejar de seguir". */
export default function FollowingScreen() {
  const [my, setMy] = useState<MyFollows | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.myFollows().then(setMy).catch((e: Error) => setError(e.message)); }, []));

  async function unfollow(row: FollowRow) {
    const before = my ?? EMPTY_FOLLOWS;
    setMy(withFollow(before, row.target, row.id, false));
    try {
      await api.follow(row.target, row.id, false);
    } catch (e) {
      setMy(before);
      setError((e as Error).message);
    }
  }

  function open(row: FollowRow) {
    if (row.target === "event") router.push(`/event/${row.id}`);
    else if (row.target === "profile") router.push(`/u/${row.id}`);
    else if (row.target === "business") router.push(`/b/${row.id}`);
    else if (row.target === "tag") router.push(`/tag/${encodeURIComponent(row.id)}`);
  }

  const sections = my ? followSections(my, { event: eventName, status: (s) => t(`st_${s}` as MessageKey) ?? s }).map((s) => ({ key: s.key, data: s.rows })) : [];
  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(r) => `${r.target}:${r.id}`}
      ListHeaderComponent={error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}
      ListEmptyComponent={my ? <Text style={styles.meta}>{t("followListEmpty")}</Text> : null}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{t(SECTION[section.key]!)}</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable accessibilityRole={item.target === "place" ? "text" : "link"} disabled={item.target === "place"} style={styles.rowText} onPress={() => open(item)}>
            <Text style={styles.title} numberOfLines={1}>{item.label}</Text>
            {item.sub ? <Text style={styles.meta} numberOfLines={1}>{item.sub}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void unfollow(item)}>
            <Text style={styles.buttonText}>{t("unfollow")}</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  section: { color: colors.text, fontWeight: "700", marginTop: space.lg, marginBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.xs },
  rowText: { flex: 1 },
  title: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 13 },
  button: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  buttonText: { color: colors.white, fontWeight: "600" },
  error: { color: colors.accentText, marginBottom: space.sm },
});
