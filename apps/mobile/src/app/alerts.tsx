import type { NotificationView } from "@dizaster/contracts";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/icon";
import { OfflineNote } from "../components/offline-note";
import { deliveryNoteKey, routeForNotificationUrl } from "../lib/alerts/logic";
import { reportUnread } from "../lib/alerts/notifications";
import { api } from "../lib/api";
import { cacheKeys, readThrough } from "../lib/offline/read-cache";
import { readCache } from "../lib/offline/sqlite-cache";
import { lang, t } from "../lib/i18n";
import { categoryStyle } from "../lib/ui/categories";
import { timeAgo } from "../lib/ui/format";
import { colors, radius, space } from "../theme";

/** Historial de alertas: todas, incluidas las que no sonaron (límite por hora, horas de silencio). */
export default function AlertsScreen() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async (more: string | null) => {
    try {
      // Solo la primera página se guarda para leer sin conexión (ADR 0066).
      const got = more ? { value: await api.notifications(more), savedAt: null } : await readThrough(readCache(), cacheKeys.alerts, () => api.notifications(null));
      const r = got.value;
      if (!more) setSavedAt(got.savedAt);
      setItems((prev) => (more ? [...prev, ...r.notifications] : r.notifications));
      setCursor(r.nextCursor);
      setUnread(r.unread);
      reportUnread(r.unread);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(null); }, [load]));

  async function openItem(n: NotificationView) {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      api.markNotificationsRead([n.id]).then((r) => { setUnread(r.unread); reportUnread(r.unread); }).catch(() => undefined);
    }
    const route = routeForNotificationUrl(n.url);
    if (route) router.push(route);
  }

  async function readAll() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    const r = await api.markNotificationsRead().catch(() => null);
    if (r) { setUnread(r.unread); reportUnread(r.unread); }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={t("alertSettings")} hitSlop={8} onPress={() => router.push("/alert-settings")}>
              <Icon name="cog-outline" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load(null)} tintColor={colors.textMuted} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (cursor) void load(cursor); }}
        ListHeaderComponent={
          savedAt ? <OfflineNote savedAt={savedAt} /> : unread > 0 ? (
            <Pressable accessibilityRole="button" style={styles.readAll} onPress={() => void readAll()}>
              <Text style={styles.readAllText}>{t("markAllRead")}</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.textMuted} style={styles.empty} /> : <Text style={styles.empty}>{error ? t("loadError") : t("noAlerts")}</Text>
        }
        renderItem={({ item }) => {
          const s = item.categoryCode ? categoryStyle(item.categoryCode) : { icon: "at" as const, color: colors.accent };
          const note = deliveryNoteKey(item.delivery);
          return (
            <Pressable accessibilityRole="link" style={[styles.row, !item.readAt && styles.unread]} onPress={() => void openItem(item)}>
              <Icon name={s.icon} size={24} color={s.color} />
              <View style={styles.body}>
                <Text style={[styles.title, !item.readAt && styles.titleUnread]}>{item.title}</Text>
                <Text style={styles.sub}>{item.body}</Text>
                <Text style={styles.meta}>
                  {timeAgo(item.createdAt, lang)}
                  {note ? ` · ${t(note)}` : ""}
                </Text>
              </View>
              {!item.readAt ? <View style={styles.dot} /> : null}
            </Pressable>
          );
        }}
      />
      <Text style={styles.privacy}>{t("privacyAlerts")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  unread: { backgroundColor: colors.surface },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 15 },
  titleUnread: { fontWeight: "700" },
  sub: { color: colors.textMuted, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: space.xs },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent, marginTop: 6 },
  readAll: { alignSelf: "flex-end", padding: space.lg },
  readAllText: { color: colors.accent, fontWeight: "600" },
  empty: { color: colors.textMuted, textAlign: "center", padding: space.xl },
  privacy: { color: colors.textMuted, fontSize: 12, textAlign: "center", padding: space.md },
});
