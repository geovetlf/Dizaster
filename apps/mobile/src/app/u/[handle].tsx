import type { ProfileView } from "@dizaster/contracts";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FeedList } from "../../components/feed-list";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Avatar } from "../../components/avatar";
import { alertFailure, confirmBlock, openFlag } from "../../lib/moderation/menu";
import { colors, radius, space } from "../../theme";
import { ErrorText } from "../../components/error-text";

/** Perfil público: solo publicaciones con autoría pública (los reportes seudónimos nunca aparecen aquí). */
export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    api.profile(handle).then(setProfile).catch((e: Error) => setError(e.message));
  }, [handle]);

  const fetchPage = useCallback((cursor: string | null) => api.profilePosts(handle ?? "", cursor), [handle]);

  async function toggleFollow() {
    if (!profile) return;
    const on = !profile.followedByMe;
    const prev = profile;
    setProfile({ ...profile, followedByMe: on, followerCount: profile.followerCount + (on ? 1 : -1) });
    await api.follow("profile", profile.handle, on).catch(() => setProfile(prev));
  }

  async function toggleBlock() {
    if (!profile) return;
    if (profile.blockedByMe) {
      // Si falla, sigue bloqueado y se dice por qué (ADR 0270).
      const ok = await api.block(profile.handle, false).then(() => true, (e: unknown) => { alertFailure(`${t("unblock")} @${profile.handle}`)(e); return false; });
      if (ok) setProfile({ ...profile, blockedByMe: false });
    } else if (await confirmBlock(profile.handle)) {
      setProfile({ ...profile, blockedByMe: true, followedByMe: false });
    }
  }

  const header = useMemo(
    () =>
      profile ? (
        <View style={styles.head}>
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={72} />
          <Text style={styles.name}>{profile.displayName}</Text>
          <Text style={styles.handle}>@{profile.handle}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          <View style={styles.stats}>
            <Stat n={profile.postCount} label={t("postsCount")} />
            <Stat n={profile.followerCount} label={t("followers")} />
            <Stat n={profile.followingCount} label={t("followingCount")} />
          </View>
          {profile.isMe ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: profile.followedByMe }}
              style={[styles.follow, profile.followedByMe && styles.followOn]}
              onPress={() => void toggleFollow()}
            >
              <Text style={styles.followText}>{profile.followedByMe ? t("followingState") : t("follow")}</Text>
            </Pressable>
          )}
          {profile.isMe ? null : (
            <View style={styles.safety}>
              <Pressable accessibilityRole="button" onPress={() => void toggleBlock()}>
                <Text style={styles.safetyText}>{profile.blockedByMe ? t("unblock") : t("block")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => openFlag("PROFILE", profile.handle)}>
                <Text style={styles.safetyText}>{t("flag")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null,
    [profile],
  );

  if (error) return <ErrorText style={styles.error}>{error}</ErrorText>;
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: profile ? `@${profile.handle}` : "" }} />
      <FeedList tab="for_you" category={null} near={null} header={header ?? undefined} fetchPage={fetchPage} sourceKey={handle ?? ""} />
    </View>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bio: { color: colors.text, textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg },
  container: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.textMuted, padding: space.lg, backgroundColor: colors.bg, flex: 1 },
  head: { alignItems: "center", paddingVertical: space.lg, gap: space.xs },
  name: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: space.sm },
  handle: { color: colors.textMuted },
  stats: { flexDirection: "row", gap: space.xl, marginVertical: space.md },
  stat: { alignItems: "center" },
  statN: { color: colors.text, fontSize: 18, fontWeight: "700" },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  follow: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, paddingVertical: space.sm, marginBottom: space.md },
  followOn: { backgroundColor: colors.surfaceAlt },
  followText: { color: colors.white, fontWeight: "700" },
  safety: { flexDirection: "row", gap: space.xl },
  safetyText: { color: colors.textMuted, fontSize: 13 },
});
