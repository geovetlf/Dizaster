import type { FeedPost, MediaView } from "@dizaster/contracts";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { LINK_DOMAIN } from "../lib/config";
import { lang, t } from "../lib/i18n";
import { categoryStyle } from "../lib/ui/categories";
import { duration, initials, mediaLayout, postWhere } from "../lib/ui/format";
import { colors, radius, space } from "../theme";
import { Icon } from "./icon";

/** Tarjeta de publicación (referencia visual: docs/design/referencia-inicio.jpg). */
export function PostCard({ post, categoryName }: { post: FeedPost; categoryName: (code: string) => string }) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);
  const style = categoryStyle(post.categoryCode);
  const name = post.author.pseudonymous ? t("citizenReporter") : post.author.displayName;
  const where = postWhere(post, lang);

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await api.setLike(post.id, next);
      setLiked(r.likedByMe);
      setLikes(r.likeCount);
    } catch {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
    }
  }

  async function share() {
    // Se comparte el evento (o el post) con enlace a la app; sin dominio aprobado se usa el esquema propio.
    const path = post.event ? `e/${post.event.id}` : `p/${post.id}`;
    const url = LINK_DOMAIN ? `https://${LINK_DOMAIN}/${path}` : `dizaster://${post.event ? `event/${post.event.id}` : `post/${post.id}`}`;
    await Share.share({ message: [post.text, url].filter(Boolean).join("\n\n") }).catch(() => undefined);
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {/* Los reportes seudónimos no enlazan a ningún perfil. */}
        <Pressable
          accessibilityRole={post.author.pseudonymous ? "text" : "link"}
          disabled={post.author.pseudonymous}
          onPress={() => { if (!post.author.pseudonymous) router.push(`/u/${post.author.handle}`); }}
          style={styles.author}
        >
          <View style={[styles.avatar, post.author.pseudonymous && styles.avatarAnon]}>
            {post.author.pseudonymous ? <Icon name="shield-account" size={22} color={colors.textMuted} /> : <Text style={styles.avatarText}>{initials(name)}</Text>}
          </View>
          <View style={styles.headText}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.meta} numberOfLines={1}>{where}</Text>
          </View>
        </Pressable>
        {post.categoryCode ? (
          <Pressable
            accessibilityRole="button"
            disabled={!post.event}
            onPress={() => post.event && router.push(`/event/${post.event.id}`)}
            style={[styles.badge, { backgroundColor: style.color === "#FFFFFF" ? colors.accent : style.color }]}
          >
            <Icon name={style.icon} size={14} color={colors.white} />
            <Text style={styles.badgeText} numberOfLines={1}>{categoryName(post.categoryCode).toUpperCase()}</Text>
          </Pressable>
        ) : null}
      </View>

      {post.text ? <Text style={styles.text}>{post.text}</Text> : null}
      <MediaGrid media={post.media} onOpen={post.event ? () => router.push(`/event/${post.event!.id}`) : undefined} />
      {post.hiddenMediaCount > 0 ? <Text style={styles.meta}>+{post.hiddenMediaCount} {t("hiddenMedia")}</Text> : null}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: liked }} style={styles.action} onPress={() => void toggleLike()}>
          <Icon name={liked ? "heart" : "heart-outline"} size={24} color={liked ? colors.like : colors.text} />
          <Text style={styles.count}>{likes}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push(`/post/${post.id}`)}>
          <Icon name="comment-outline" size={22} color={colors.text} />
          <Text style={styles.count}>{post.commentCount}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => void share()}>
          <Icon name="share-variant-outline" size={22} color={colors.text} />
          <Text style={styles.count}>{t("share")}</Text>
        </Pressable>
        <View style={styles.spacer} />
        {post.event ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("viewEvent")} onPress={() => router.push(`/event/${post.event!.id}`)}>
            <Icon name="dots-horizontal" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Tocar la media abre el evento, donde las fotos se ven completas y los videos se reproducen. */
function MediaGrid({ media, onOpen }: { media: MediaView[]; onOpen: (() => void) | undefined }) {
  const { main, side, extra } = mediaLayout(media);
  if (!main) return null;
  if (side.length === 0) return <Pressable accessibilityRole="button" disabled={!onOpen} onPress={onOpen}><Tile m={main} style={styles.single} /></Pressable>;
  return (
    <Pressable accessibilityRole="button" disabled={!onOpen} onPress={onOpen} style={styles.grid}>
      <Tile m={main} style={styles.main} />
      <View style={styles.sideCol}>
        {side.map((m) => <Tile key={m.id} m={m} style={styles.side} />)}
      </View>
      {extra > 0 ? (
        <View style={styles.extra}><Text style={styles.extraText}>+{extra}</Text></View>
      ) : null}
    </Pressable>
  );
}

/** Miniatura: foto o, para video, un marco con botón de reproducción y duración (sin cargar el video). */
function Tile({ m, style }: { m: MediaView; style: object }) {
  if (m.kind === "IMAGE") return <Image source={{ uri: m.url }} style={[styles.tile, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.tile, styles.videoTile, style]}>
      <View style={styles.play}><Icon name="play" size={30} color={colors.white} /></View>
      <Text style={styles.duration}>{duration(m.durationMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarAnon: { borderWidth: 1, borderColor: colors.border },
  avatarText: { color: colors.text, fontWeight: "700" },
  headText: { flex: 1 },
  author: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, maxWidth: 150 },
  badgeText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  text: { color: colors.text, fontSize: 15, lineHeight: 21, marginBottom: space.sm },
  single: { width: "100%", height: 180 },
  grid: { flexDirection: "row", gap: 6, height: 180 },
  main: { flex: 2, height: "100%" },
  sideCol: { flex: 1.1, gap: 6 },
  side: { flex: 1 },
  extra: { width: 70, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  extraText: { color: colors.text, fontSize: 20, fontWeight: "700" },
  tile: { borderRadius: radius.md, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  videoTile: { alignItems: "center", justifyContent: "center", backgroundColor: "#11161D" },
  play: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center" },
  duration: { position: "absolute", right: 8, bottom: 8, color: colors.white, backgroundColor: "#000000AA", paddingHorizontal: 6, borderRadius: 4, fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: space.xl, marginTop: space.md },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { color: colors.text, fontSize: 14 },
  spacer: { flex: 1 },
});
