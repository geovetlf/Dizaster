import type { FeedPost, FeedResponse, FeedTab } from "@dizaster/contracts";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";
import { PostCard } from "./post-card";
import { categoryLabel } from "../lib/category-store";
import { cacheKeys, readThrough } from "../lib/offline/read-cache";
import { readCache } from "../lib/offline/sqlite-cache";
import { OfflineNote } from "./offline-note";

export const categoryName = categoryLabel;

/** Lista paginada del feed. La usan el inicio, la pestaña de videos y los perfiles (con `fetchPage`). */
export function FeedList(props: {
  tab: FeedTab;
  category: string | null;
  near: { lat: number; lng: number } | null;
  header?: ReactElement;
  empty?: ReactElement;
  /** Otra fuente paginada (p. ej. los posts de un perfil); `sourceKey` la identifica para reiniciar la lista. */
  fetchPage?: (cursor: string | null) => Promise<FeedResponse>;
  sourceKey?: string;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Primera página guardada sin conexión (ADR 0294): hora de la copia que se muestra, o null si es fresca.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const request = useRef(0);
  const needsLocation = props.tab === "nearby" && !props.near;

  const load = useCallback(async (reset: boolean) => {
    if (needsLocation) { setPosts([]); setCursor(null); return; }
    const id = ++request.current;
    setLoading(true);
    setError(false);
    try {
      const next = reset ? null : cursor;
      const fetchFeed = () => api.feed({ tab: props.tab, category: props.category, near: props.near, cursor: next });
      const key = !props.fetchPage && reset ? cacheKeys.feed(props.tab, props.category) : null;
      const got = props.fetchPage
        ? { value: await props.fetchPage(next), savedAt: null }
        : key ? await readThrough(readCache(), key, fetchFeed) : { value: await fetchFeed(), savedAt: null };
      const r = got.value;
      if (id !== request.current) return; // respuesta de un filtro anterior
      if (reset) setSavedAt(got.savedAt);
      setPosts((prev) => (reset ? r.posts : [...prev, ...r.posts]));
      setCursor(r.nextCursor);
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [props.tab, props.category, props.near, props.fetchPage, cursor, needsLocation]);

  // Cambiar pestaña, categoría o ubicación reinicia la lista.
  useEffect(() => { void load(true); }, [props.tab, props.category, props.near?.lat, props.near?.lng, props.sourceKey]);

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PostCard post={item} categoryName={categoryName} />}
      ListHeaderComponent={savedAt ? <>{props.header}<OfflineNote savedAt={savedAt} /></> : props.header}
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
      // Con la copia guardada no se piden más páginas: sin red fallarían y la copia es solo la primera.
      onEndReached={() => { if (cursor && !loading && !savedAt) void load(false); }}
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
  retry: { color: colors.accentText, marginTop: space.sm, fontWeight: "600" },
  loader: { marginVertical: space.lg },
});
