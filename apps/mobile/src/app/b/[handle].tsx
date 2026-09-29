import type { BusinessView } from "@dizaster/contracts";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { FeedList } from "../../components/feed-list";
import { Avatar } from "../../components/avatar";
import { Icon } from "../../components/icon";
import { api } from "../../lib/api";
import { lang, t } from "../../lib/i18n";
import { confirmBlock, openFlag } from "../../lib/moderation/menu";
import { BUSINESS_CATEGORY_LABEL, telUri, verificationIcon } from "../../lib/social/business";
import { colors, radius, space } from "../../theme";

/** Página de un negocio: datos públicos que el negocio eligió publicar y sus posts. */
export default function BusinessScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const [b, setB] = useState<BusinessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    api.business(handle).then(setB).catch((e: Error) => setError(e.message));
  }, [handle]);

  const fetchPage = useCallback((cursor: string | null) => api.businessPosts(handle ?? "", cursor), [handle]);

  async function toggleFollow() {
    if (!b) return;
    const on = !b.followedByMe;
    const prev = b;
    setB({ ...b, followedByMe: on, followerCount: b.followerCount + (on ? 1 : -1) });
    await api.follow("business", b.handle, on).catch(() => setB(prev));
  }

  async function toggleBlock() {
    if (!b) return;
    if (b.blockedByMe) {
      await api.block(b.handle, false).catch(() => undefined);
      setB({ ...b, blockedByMe: false });
    } else if (await confirmBlock(b.handle)) {
      setB({ ...b, blockedByMe: true, followedByMe: false });
    }
  }

  const header = useMemo(() => {
    if (!b) return null;
    const badge = verificationIcon(b.verification);
    return (
      <View style={styles.head}>
        <Avatar name={b.name} url={b.logoUrl} size={72} square />
        <View style={styles.nameRow}>
          <Text style={styles.name}>{b.name}</Text>
          {badge ? <Icon name={badge} size={20} color={colors.link} accessibilityLabel={t(b.verification === "INSTITUTIONAL_OFFICIAL" ? "businessInstitutional" : "businessVerified")} /> : null}
        </View>
        <Text style={styles.meta}>@{b.handle} · {BUSINESS_CATEGORY_LABEL[b.category][lang]}</Text>
        {b.description ? <Text style={styles.description}>{b.description}</Text> : null}
        {b.addressPublic ? <Text style={styles.meta}>{b.addressPublic}</Text> : null}
        <View style={styles.row}>
          {b.contactPhone ? (
            <Pressable accessibilityRole="button" style={styles.chip} onPress={() => void Linking.openURL(telUri(b.contactPhone!))}>
              <Icon name="phone" size={16} color={colors.text} /><Text style={styles.chipText}>{t("call")}</Text>
            </Pressable>
          ) : null}
          {b.contactUrl ? (
            <Pressable accessibilityRole="link" style={styles.chip} onPress={() => void Linking.openURL(b.contactUrl!)}>
              <Icon name="web" size={16} color={colors.text} /><Text style={styles.chipText}>{t("website")}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.meta}>{b.postCount} {t("postsCount")} · {b.followerCount} {t("followers")}</Text>
        {b.isMine ? (
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.follow} onPress={() => router.push({ pathname: "/compose", params: { asBusiness: b.handle } })}>
              <Text style={styles.followText}>{t("newPost")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.follow, styles.followOn]} onPress={() => router.push({ pathname: "/business-edit", params: { handle: b.handle } })}>
              <Text style={styles.followText}>{t("edit")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: b.followedByMe }} style={[styles.follow, b.followedByMe && styles.followOn]} onPress={() => void toggleFollow()}>
              <Text style={styles.followText}>{b.followedByMe ? t("followingState") : t("follow")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void toggleBlock()} style={styles.flag}>
              <Text style={styles.meta}>{b.blockedByMe ? t("unblock") : t("block")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => openFlag("BUSINESS", b.handle)} style={styles.flag}>
              <Text style={styles.meta}>{t("flag")}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }, [b]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: b ? b.name : "" }} />
      <FeedList tab="for_you" category={null} near={null} header={header ?? undefined} fetchPage={fetchPage} sourceKey={handle ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.textMuted, padding: space.lg, backgroundColor: colors.bg, flex: 1 },
  head: { alignItems: "center", paddingVertical: space.lg, gap: space.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.sm },
  name: { color: colors.text, fontSize: 20, fontWeight: "800" },
  meta: { color: colors.textMuted, textAlign: "center" },
  description: { color: colors.text, textAlign: "center", marginVertical: space.xs },
  row: { flexDirection: "row", gap: space.sm, marginVertical: space.sm, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  chipText: { color: colors.text },
  follow: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, paddingVertical: space.sm },
  followOn: { backgroundColor: colors.surfaceAlt },
  followText: { color: colors.white, fontWeight: "700" },
  flag: { padding: space.sm },
});
