import type { CategoryCatalog, FeedPost, FeedTab } from "@dizaster/contracts";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { colors, radius, space } from "../theme";
import { PostCard } from "./post-card";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;
const names = new Map(catalog.categories.map((c) => [c.code, c.names[lang] ?? c.names["es"] ?? c.code]));
const categoryName = (code: string) => names.get(code) ?? names.get(code.split(".")[0]!) ?? code;

/** Lista paginada del feed. La usan el inicio y la pestaña de videos. */
export function FeedList(props: {
  tab: FeedTab;
  category: string | null;
  near: { lat: number; lng: number } | null;
  header?: ReactElement;
  empty?: ReactElement;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const needsLocation = props.tab === "nearby" && !props.near;

  const load = useCallback(async (reset: boolean) => {
    if (needsLocation) { setPosts([]); setCursor(null); return; }
    const id = ++request.current;
    setLoading(true);
    setError(false);
    try {
      const r = await api.feed({ tab: props.tab, category: props.category, near: props.near, cursor: reset ? null : cursor });
      if (id !== request.current) return; // respuesta de un filtro anterior
      setPosts((prev) => (reset ? r.posts : [...prev, ...r.posts]));
      setCursor(r.nextCursor);
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [props.tab, props.category, props.near, cursor, needsLocation]);

  // Cambiar pestaña, categoría o ubicación reinicia la lista.
  useEffect(() => { void load(true); }, [props.tab, props.category, props.near?.lat, props.near?.lng]);

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PostCard post={item} categoryName={categoryName} />}
      ListHeaderComponent={props.header}
      ListEmptyComponent={
        loading ? null : error ? (
          <Pressable accessibilityRole="button" style={styles.empty} onPress={() => void load(true)}>
            <Text style={styles.emptyText}>{t("loadError")}</Text>
            <Text style={styles.retry}>{t("retry")}</Text>
          </Pressable>
        ) : (props.empty ?? <View style={styles.empty}><Text style={styles.emptyText}>{t("emptyFeed")}</Text></View>)
      }
      ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (cursor && !loading) void load(false); }}
      refreshControl={<RefreshControl tintColor={colors.accent} refreshing={false} onRefresh={() => void load(true)} />}
      contentContainerStyle={styles.content}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingBottom: 40 },
  empty: { padding: space.xl, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  retry: { color: colors.accent, marginTop: space.sm, fontWeight: "600" },
  loader: { marginVertical: space.lg },
});
