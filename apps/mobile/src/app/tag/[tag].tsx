import type { TagView } from "@dizaster/contracts";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FeedList } from "../../components/feed-list";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { colors, radius, space } from "../../theme";
import { ErrorText } from "../../components/error-text";

/** Posts públicos con una etiqueta, por recientes. Se puede seguir la etiqueta para verla en "Siguiendo". */
export default function TagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const [view, setView] = useState<TagView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tag) return;
    api.tag(tag).then(setView).catch((e: Error) => setError(e.message));
  }, [tag]);

  const fetchPage = useCallback((cursor: string | null) => api.tagPosts(tag ?? "", cursor), [tag]);

  async function toggleFollow() {
    if (!view) return;
    const on = !view.followedByMe;
    const prev = view;
    setView({ ...view, followedByMe: on, followerCount: view.followerCount + (on ? 1 : -1) });
    await api.follow("tag", view.tag, on).catch(() => setView(prev));
  }

  const header = useMemo(
    () =>
      view ? (
        <View style={styles.head}>
          <Text style={styles.name}>#{view.display}</Text>
          <Text style={styles.meta}>{view.postCount} {t("postsCount")} · {view.followerCount} {t("followers")}</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: view.followedByMe }} style={[styles.follow, view.followedByMe && styles.followOn]} onPress={() => void toggleFollow()}>
              <Text style={styles.followText}>{view.followedByMe ? t("followingState") : t("follow")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.follow, styles.followOn]} onPress={() => router.push({ pathname: "/compose", params: { text: `#${view.display} ` } })}>
              <Text style={styles.followText}>{t("newPost")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null,
    [view],
  );

  if (error) return <ErrorText style={styles.error}>{error}</ErrorText>;
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: view ? `#${view.display}` : "" }} />
      <FeedList tab="for_you" category={null} near={null} header={header ?? undefined} fetchPage={fetchPage} sourceKey={tag ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.textMuted, padding: space.lg, backgroundColor: colors.bg, flex: 1 },
  head: { alignItems: "center", paddingVertical: space.lg, gap: space.xs },
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  meta: { color: colors.textMuted },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  follow: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, paddingVertical: space.sm },
  followOn: { backgroundColor: colors.surfaceAlt },
  followText: { color: colors.white, fontWeight: "700" },
});
