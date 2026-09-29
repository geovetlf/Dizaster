import { reactionKindsFor, type FeedPost, type MediaView, type ReactionKind, type ReactionState } from "@dizaster/contracts";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { LINK_DOMAIN } from "../lib/config";
import { canBlock } from "../lib/moderation/logic";
import { openContentMenu, openOwnPostMenu } from "../lib/moderation/menu";
import { verificationIcon } from "../lib/social/business";
import { useMe } from "../lib/social/me";
import { applyReaction, CONTEXT_REACTIONS } from "../lib/social/reactions";
import { lang, t } from "../lib/i18n";
import { foreignLanguageName } from "../lib/language";
import { categoryStyle } from "../lib/ui/categories";
import { duration, imageUri, initials, mediaLayout, postWhere } from "../lib/ui/format";
import { colors, radius, space } from "../theme";
import { Icon } from "./icon";
import { RichText } from "./rich-text";
import { SensitiveCover } from "./sensitive-cover";

/** Tarjeta de publicación (referencia visual: docs/design/referencia-inicio.jpg). */
export function PostCard({ post, categoryName }: { post: FeedPost; categoryName: (code: string) => string }) {
  const [react, setReact] = useState<ReactionState>({ reactions: post.reactions, myReactions: post.myReactions });
  const [hidden, setHidden] = useState(false);
  const me = useMe();
  const style = categoryStyle(post.categoryCode);
  const name = post.author.pseudonymous ? t("citizenReporter") : post.author.displayName;
  const where = postWhere(post, lang);
  const badge = post.author.pseudonymous ? null : verificationIcon(post.author.business?.verification);

  const liked = react.myReactions.includes("LIKE");
  const offered = reactionKindsFor(post);

  async function toggle(kind: ReactionKind) {
    const on = !react.myReactions.includes(kind);
    const before = react;
    setReact((s) => applyReaction(s, kind, on));
    try {
      setReact(await api.setReaction(post.id, kind, on));
    } catch {
      setReact(before);
      return;
    }
    // "Yo también lo vi" no verifica nada: si la persona está allí, se le ofrece reportar para que cuente.
    if (on && kind === "SEEN_TOO" && post.event && post.categoryCode) {
      const params = { eventId: post.event.id, category: post.categoryCode };
      Alert.alert(t("reactSeenToo"), t("seenTooReportHint"), [
        { text: t("notNow"), style: "cancel" },
        { text: t("report"), onPress: () => router.push({ pathname: "/report", params }) },
      ]);
    }
  }

  async function shareOutside() {
    // Se comparte el evento (o el post) con enlace a la app; sin dominio aprobado se usa el esquema propio.
    const path = post.event ? `e/${post.event.id}` : `p/${post.id}`;
    const url = LINK_DOMAIN ? `https://${LINK_DOMAIN}/${path}` : `dizaster://${post.event ? `event/${post.event.id}` : `post/${post.id}`}`;
    await Share.share({ message: [post.text, url].filter(Boolean).join("\n\n") }).catch(() => undefined);
  }

  /** Compartir en Dizaster (ADR 0046) o fuera de la app. Lo compartido se comparte desde su original. */
  function share() {
    const target = post.share?.post?.id ?? post.id;
    if (post.share && !post.share.post) return void shareOutside();
    Alert.alert(t("share"), undefined, [
      { text: t("shareInApp"), onPress: () => router.push({ pathname: "/compose", params: { shareOf: target } }) },
      { text: t("shareOutside"), onPress: () => void shareOutside() },
      { text: t("cancel"), style: "cancel" },
    ]);
  }

  if (hidden) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {/* Los reportes seudónimos no enlazan a ningún perfil. */}
        <Pressable
          accessibilityRole={post.author.pseudonymous ? "text" : "link"}
          disabled={post.author.pseudonymous}
          onPress={() => { if (!post.author.pseudonymous) router.push(post.author.business ? `/b/${post.author.handle}` : `/u/${post.author.handle}`); }}
          style={styles.author}
        >
          <View style={[styles.avatar, post.author.pseudonymous && styles.avatarAnon]}>
            {post.author.pseudonymous ? <Icon name="shield-account" size={22} color={colors.textMuted} /> : <Text style={styles.avatarText}>{initials(name)}</Text>}
          </View>
          <View style={styles.headText}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              {badge ? <Icon name={badge} size={16} color={colors.link} /> : null}
            </View>
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

      {post.text ? <RichText text={post.text} mentions={post.mentions} businessMentions={post.businessMentions} style={styles.text} /> : null}
      {foreignLanguageName(post.lang, lang) ? <Text style={styles.meta}>{t("writtenIn")} {foreignLanguageName(post.lang, lang)}</Text> : null}
      {post.share ? <SharedPost post={post.share.post} categoryName={categoryName} /> : null}
      <MediaGrid media={post.media} onOpen={post.event ? () => router.push(`/event/${post.event!.id}`) : undefined} />
      {post.hiddenMediaCount > 0 ? <Text style={styles.meta}>+{post.hiddenMediaCount} {t("hiddenMedia")}</Text> : null}

      <View style={styles.context}>
        {CONTEXT_REACTIONS.filter((r) => offered.includes(r.kind)).map((r) => {
          const on = react.myReactions.includes(r.kind);
          const n = react.reactions[r.kind] ?? 0;
          return (
            <Pressable key={r.kind} accessibilityRole="button" accessibilityLabel={t(r.label)} accessibilityState={{ selected: on }}
              onPress={() => void toggle(r.kind)} style={[styles.chip, on && styles.chipOn]}>
              <Icon name={on ? r.icon[1] : r.icon[0]} size={16} color={on ? colors.white : colors.textMuted} />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{n > 0 ? `${t(r.label)} · ${n}` : t(r.label)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: liked }} style={styles.action} onPress={() => void toggle("LIKE")}>
          <Icon name={liked ? "heart" : "heart-outline"} size={24} color={liked ? colors.like : colors.text} />
          <Text style={styles.count}>{react.reactions.LIKE ?? 0}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push(`/post/${post.id}`)}>
          <Icon name="comment-outline" size={22} color={colors.text} />
          <Text style={styles.count}>{post.commentCount}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("share")} style={styles.action} onPress={share}>
          <Icon name="share-variant-outline" size={22} color={colors.text} />
          <Text style={styles.count}>{post.shareCount > 0 ? post.shareCount : t("share")}</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("options")}
          hitSlop={8}
          onPress={() =>
            post.mine
              ? openOwnPostMenu({ id: post.id, isReport: post.kind === "REPORT" }, () => setHidden(true))
              : openContentMenu({ type: "POST", id: post.id, blockHandle: canBlock(post.author, me.handle) && !post.author.pseudonymous ? post.author.handle : null }, () => setHidden(true))}
        >
          <Icon name="dots-horizontal" size={24} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

/** Original de un post compartido, en pequeño. Si ya no está disponible se dice, sin más detalle. */
function SharedPost({ post, categoryName }: { post: FeedPost | null; categoryName: (code: string) => string }) {
  if (!post) return <View style={styles.shared}><Text style={styles.meta}>{t("sharedUnavailable")}</Text></View>;
  const name = post.author.pseudonymous ? t("citizenReporter") : post.author.displayName;
  const first = post.media[0];
  return (
    <Pressable accessibilityRole="button" style={styles.shared}
      onPress={() => router.push(post.event ? `/event/${post.event.id}` : `/post/${post.id}`)}>
      <Text style={styles.sharedName} numberOfLines={1}>
        {name}{post.categoryCode ? ` · ${categoryName(post.categoryCode)}` : ""}
      </Text>
      {post.text ? <Text style={styles.text} numberOfLines={4}>{post.text}</Text> : null}
      {first ? <Tile m={first} style={styles.sharedMedia} small /> : null}
    </Pressable>
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
        {side.map((m) => <Tile key={m.id} m={m} style={styles.side} small />)}
      </View>
      {extra > 0 ? (
        <View style={styles.extra}><Text style={styles.extraText}>+{extra}</Text></View>
      ) : null}
    </Pressable>
  );
}

/** Miniatura: foto o, para video, su póster (si lo hay) con botón de reproducción y duración (sin cargar el video). */
function Tile({ m, style, small = false }: { m: MediaView; style: object; small?: boolean }) {
  return <SensitiveCover m={m} style={[styles.tile, style]}><TileContent m={m} style={style} small={small} /></SensitiveCover>;
}

function TileContent({ m, style, small }: { m: MediaView; style: object; small: boolean }) {
  if (m.kind === "IMAGE") return <Image source={{ uri: imageUri(m, small ? "small" : "large") }} style={[styles.tile, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.tile, styles.videoTile, style]}>
      {m.thumbUrl ? (
        <Image source={{ uri: small ? m.thumbUrl : (m.posterUrl ?? m.thumbUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : null}
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
  name: { color: colors.text, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
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
  duration: { position: "absolute", end: 8, bottom: 8, color: colors.white, backgroundColor: "#000000AA", paddingHorizontal: 6, borderRadius: 4, fontSize: 12 },
  context: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13 },
  chipTextOn: { color: colors.white },
  shared: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  sharedName: { color: colors.text, fontWeight: "700", marginBottom: 4 },
  sharedMedia: { width: "100%", height: 120 },
  actions: { flexDirection: "row", alignItems: "center", gap: space.xl, marginTop: space.md },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { color: colors.text, fontSize: 14 },
  spacer: { flex: 1 },
});
