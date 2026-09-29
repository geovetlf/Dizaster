import type { AreaSearchResult, BusinessView, CategoryCatalog, EventSummary, FeedPost, ProfileSearchResult, TagView } from "@dizaster/contracts";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import { lang, t, verificationLabel } from "../lib/i18n";
import { BUSINESS_CATEGORY_LABEL } from "../lib/social/business";
import { POST_SEARCH_MIN, postAuthorLabel, postSnippet } from "../lib/social/post-search";
import { categoryStyle } from "../lib/ui/categories";
import { areaRow, bboxParam, initials, timeAgo } from "../lib/ui/format";
import { useCoarseLocation } from "../lib/ui/use-coarse-location";
import { colors, radius, space } from "../theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Row =
  | { type: "event"; event: EventSummary }
  | { type: "area"; area: AreaSearchResult }
  | { type: "person"; person: ProfileSearchResult }
  | { type: "tag"; tag: TagView }
  | { type: "business"; business: BusinessView }
  | { type: "post"; post: FeedPost }
  | { type: "category"; code: string; name: string };

/**
 * Búsqueda: eventos (categoría + lugar + título, ADR 0065), lugares (índice geográfico propio, sin geocodificador
 * comercial), personas, etiquetas y categorías (catálogo empaquetado, funciona sin conexión).
 */
export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [areas, setAreas] = useState<AreaSearchResult[]>([]);
  const [people, setPeople] = useState<ProfileSearchResult[]>([]);
  const [tags, setTags] = useState<TagView[]>([]);
  const [businesses, setBusinesses] = useState<BusinessView[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const location = useCoarseLocation();
  const near = location.point;

  const categories = useMemo(() => {
    const n = normalize(q.trim());
    return catalog.categories.filter((c) => !n || Object.values(c.names).some((name) => normalize(name).includes(n)));
  }, [q]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setEvents([]); setAreas([]); setPeople([]); setTags([]); setBusinesses([]); setPosts([]); return; }
    let live = true;
    // Espera a que el usuario deje de escribir: menos peticiones, menos coste.
    const timer = setTimeout(() => {
      api.searchEvents(text, near).then((r) => { if (live) setEvents(r.events); }).catch(() => { if (live) setEvents([]); });
      api.areas(text, near).then((r) => { if (live) setAreas(r.areas); }).catch(() => { if (live) setAreas([]); });
      api.searchProfiles(text).then((r) => { if (live) setPeople(r.profiles); }).catch(() => { if (live) setPeople([]); });
      api.searchTags(text).then((r) => { if (live) setTags(r.tags); }).catch(() => { if (live) setTags([]); });
      api.searchBusinesses(text).then((r) => { if (live) setBusinesses(r.businesses); }).catch(() => { if (live) setBusinesses([]); });
      // Publicaciones por texto (ADR 0107): desde 3 letras, como el servidor.
      if (text.length >= POST_SEARCH_MIN) api.searchPosts(text).then((r) => { if (live) setPosts(r.posts); }).catch(() => { if (live) setPosts([]); });
      else setPosts([]);
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, near]);

  const sections = [
    ...(events.length ? [{ title: t("searchEvents"), data: events.map((event): Row => ({ type: "event", event })) }] : []),
    ...(areas.length ? [{ title: t("searchPlaces"), data: areas.map((area): Row => ({ type: "area", area })) }] : []),
    ...(people.length ? [{ title: t("searchPeople"), data: people.map((person): Row => ({ type: "person", person })) }] : []),
    ...(businesses.length ? [{ title: t("searchBusinesses"), data: businesses.map((business): Row => ({ type: "business", business })) }] : []),
    ...(posts.length ? [{ title: t("searchPosts"), data: posts.map((post): Row => ({ type: "post", post })) }] : []),
    ...(tags.length ? [{ title: t("searchTags"), data: tags.map((tag): Row => ({ type: "tag", tag })) }] : []),
    {
      title: t("searchCategories"),
      data: categories.map((c): Row => ({ type: "category", code: c.code, name: c.names[lang] ?? c.names["es"] ?? c.code })),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        <Icon name="magnify" size={22} color={colors.textMuted} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t("searchPlaceholder")} placeholderTextColor={colors.textMuted} style={styles.input} />
      </View>
      <SectionList
        sections={sections}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(r) => (r.type === "event" ? `e:${r.event.id}` : r.type === "area" ? r.area.id : r.type === "person" ? `@${r.person.handle}` : r.type === "tag" ? `#${r.tag.tag}` : r.type === "business" ? `b:${r.business.handle}` : r.type === "post" ? `p:${r.post.id}` : r.code)}
        renderSectionHeader={({ section }) => <Text style={styles.note}>{section.title}</Text>}
        renderItem={({ item }) => {
          if (item.type === "event") {
            const s = categoryStyle(item.event.categoryCode);
            const name = catalog.categories.find((c) => c.code === item.event.categoryCode)?.names;
            return (
              <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/event/${item.event.id}`)}>
                <Icon name={s.icon} size={22} color={s.color} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{name?.[lang] ?? name?.["es"] ?? item.event.categoryCode}{item.event.place ? ` · ${item.event.place.label}` : ""}</Text>
                  <Text style={styles.rowSub}>{verificationLabel(item.event.publicVerificationState)} · {timeAgo(item.event.lastActivityAt, lang)}</Text>
                </View>
              </Pressable>
            );
          }
          if (item.type === "area") {
            const row = areaRow(item.area);
            return (
              <Pressable
                accessibilityRole="button"
                style={styles.row}
                onPress={() => { router.dismissTo({ pathname: "/map", params: { bbox: bboxParam(item.area.bbox) } }); }}
              >
                <Icon name="map-marker" size={22} color={colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{row.title}</Text>
                  <Text style={styles.rowSub}>{row.subtitle}</Text>
                </View>
              </Pressable>
            );
          }
          if (item.type === "person") {
            return (
              <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/u/${item.person.handle}`)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.person.displayName)}</Text></View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{item.person.displayName}</Text>
                  <Text style={styles.rowSub}>@{item.person.handle} · {item.person.followerCount} {t("followers")}</Text>
                </View>
              </Pressable>
            );
          }
          if (item.type === "business") {
            return (
              <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/b/${item.business.handle}`)}>
                <Icon name="storefront-outline" size={22} color={colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{item.business.name}</Text>
                  <Text style={styles.rowSub}>@{item.business.handle} · {BUSINESS_CATEGORY_LABEL[item.business.category][lang]}</Text>
                </View>
              </Pressable>
            );
          }
          if (item.type === "post") {
            return (
              <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/post/${item.post.id}`)}>
                <Icon name="text-box-outline" size={22} color={colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText} numberOfLines={2}>{postSnippet(item.post.text, q)}</Text>
                  <Text style={styles.rowSub}>{postAuthorLabel(item.post.author, t("pseudonymousAuthor"))} · {timeAgo(item.post.createdAt, lang)}</Text>
                </View>
              </Pressable>
            );
          }
          if (item.type === "tag") {
            return (
              <Pressable accessibilityRole="link" style={styles.row} onPress={() => router.push(`/tag/${encodeURIComponent(item.tag.tag)}`)}>
                <Icon name="pound" size={22} color={colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>#{item.tag.display}</Text>
                  <Text style={styles.rowSub}>{item.tag.postCount} {t("postsCount")} · {item.tag.followerCount} {t("followers")}</Text>
                </View>
              </Pressable>
            );
          }
          const s = categoryStyle(item.code);
          return (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => { router.dismissTo({ pathname: "/", params: { category: item.code } }); }}>
              <Icon name={s.icon} size={22} color={s.color} />
              <Text style={styles.rowText}>{item.name}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  box: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.lg },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  note: { color: colors.textMuted, marginVertical: space.md, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { color: colors.text, fontSize: 16 },
  rowBody: { flex: 1 },
  rowSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontWeight: "700", fontSize: 12 },
});
