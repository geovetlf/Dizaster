import type { EventDetail, EventSourceView, OfficialScopeView, MediaView, TimelineEntryView, VerificationView } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { FeedList } from "../../components/feed-list";
import { EventMedia } from "../../components/event-media";
import { EventAreaMap } from "../../components/event-area-map";
import { OfflineNote } from "../../components/offline-note";
import { api } from "../../lib/api";
import { cacheKeys, readThrough } from "../../lib/offline/read-cache";
import { readCache } from "../../lib/offline/sqlite-cache";
import { lang, t, tCount, tf, VERIFICATION_LABEL, verificationLabel } from "../../lib/i18n";
import { eventStatusLine, eventWhenParts } from "../../lib/ui/event-status";
import { eventTime, eventTitle, formatInZone, timeAgo } from "../../lib/ui/format";
import { evidenceLine, explainLines, timelineLabel } from "../../lib/verification/explain";
import { followablePlace } from "../../lib/social/place";
import { useFollows } from "../../lib/social/follows";
import { mergedTarget } from "../../lib/events/merged";
import { LINK_DOMAIN } from "../../lib/config";
import { shareUrl } from "../../lib/links";
import { canStateOn } from "../../lib/social/business";
import { openFlag } from "../../lib/moderation/menu";
import { categoryStyle } from "../../lib/ui/categories";
import { colors, radius, space } from "../../theme";
import { appendPage, newestFirst } from "../../lib/ui/pages";
import { evidenceCounts } from "../../lib/events/counts";
import { secondaryLine } from "../../lib/events/secondary";
import { categoryLabel } from "../../lib/category-store";
import { LoadState } from "../../components/load-state";
import { classifyLoadError, type LoadErrorKind } from "../../lib/errors/load-error";

const categoryName = categoryLabel;

const TIMELINE_SHOWN = 12;

/** Pantalla de evento. También es el destino de los deep links: dizaster://event/<id> y https://<dominio>/e/<id>. */
export default function EventScreen() {
  const { id, hops } = useLocalSearchParams<{ id: string; hops?: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntryView[]>([]);
  // Timeline por páginas, de lo más reciente hacia atrás (ADR 0106).
  const [timelineNext, setTimelineNext] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaView[]>([]);
  const [mediaNext, setMediaNext] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationView | null>(null);
  const [sources, setSources] = useState<EventSourceView[]>([]);
  // ADR 0212: por qué no cargó (borrado, sin red, otro) y un contador para reintentar.
  const [error, setError] = useState<LoadErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const follows = useFollows();
  const [institutions, setInstitutions] = useState<{ handle: string; name: string; scope: OfficialScopeView | null }[]>([]);

  useEffect(() => {
    if (!id) return;
    // Sin red se muestra la última versión guardada del evento (ADR 0066).
    readThrough(readCache(), cacheKeys.event(id), () => Promise.all([api.event(id), api.timeline(id, { order: "desc", limit: TIMELINE_SHOWN })]))
      .then(({ value: [e, tl], savedAt }) => {
        // Evento fusionado (ADR 0093): enlaces, avisos y seguidos antiguos llevan al evento que queda.
        const target = mergedTarget(e, Number(hops ?? 0));
        if (target) { router.replace(`/event/${target}?hops=${Number(hops ?? 0) + 1}`); return; }
        setEvent(e); setTimeline(tl.entries); setTimelineNext(tl.nextCursor ?? null); setSavedAt(savedAt);
      })
      .catch((e: unknown) => setError(classifyLoadError(e)));
    // La media es secundaria: si falla, el evento se muestra igual.
    api.eventMedia(id).then((r) => { setMedia(r.media); setMediaNext(r.nextCursor ?? null); }).catch(() => setMedia([]));
    api.verification(id).then(setVerification).catch(() => setVerification(null));
    api.eventSources(id).then((r) => setSources(r.sources)).catch(() => setSources([]));
    // Perfiles institucionales oficiales que administro (ADR 0095): pueden confirmar o desmentir en su ámbito.
    api.myBusinesses()
      .then((r) => Promise.all(r.businesses.filter((b) => b.verification === "INSTITUTIONAL_OFFICIAL")
        .map(async (b) => ({ handle: b.handle, name: b.name, scope: (await api.officialScope(b.handle)).scope }))))
      .then(setInstitutions)
      .catch(() => setInstitutions([]));
  }, [id, hops, attempt]);

  function officialStatement(handle: string, name: string) {
    if (!event) return;
    const send = (assertion: "OCCURRING" | "NOT_OCCURRING") => void api.officialStatement(handle, event.id, assertion)
      .then(() => api.verification(event.id).then(setVerification))
      .then(() => api.eventSources(event.id).then((r) => setSources(r.sources)))
      .catch((e: Error) => Alert.alert(name, e.message));
    Alert.alert(`${t("officialStatement")} · ${name}`, t("officialStatementHint"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("officialDeny"), style: "destructive", onPress: () => send("NOT_OCCURRING") },
      { text: t("officialConfirm"), onPress: () => send("OCCURRING") },
    ]);
  }

  const fetchPage = useCallback((cursor: string | null) => api.eventPosts(id ?? "", cursor), [id]);

  if (error) return <LoadState state={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />;
  if (!event) return <LoadState state="loading" />;
  const color = VERIFICATION_LABEL[event.publicVerificationState]?.color ?? "#8a94a6";
  const place = followablePlace(event.place);
  const also = secondaryLine(event, categoryName, t("alsoCategories"));
  const header = (
    <View style={styles.header}>
      {savedAt ? <OfflineNote savedAt={savedAt} /> : null}
      <Text style={styles.title}>{eventTitle(event, lang)}</Text>
      {event.place ? <Text style={styles.place}>{event.place.label}</Text> : null}
      {also ? <Text style={styles.place}>{also}</Text> : null}
      <View style={styles.follows}>
        <FollowChip label={t("followEvent")} on={follows.following("event", event.id)} onPress={() => void follows.toggle("event", event.id)} />
        {place ? (
          <FollowChip label={`${t("followPlace")} ${place.name}`} on={follows.following("place", place.id)} onPress={() => void follows.toggle("place", place.id, place.name)} />
        ) : null}
        <FollowChip label={t("postAboutThis")} on={false} onPress={() => router.push({ pathname: "/compose", params: { eventId: event.id } })} />
        {event.status === "ACTIVE" || event.status === "MONITORING" ? (
          <FollowChip label={t("seenTooChip")} on={false}
            onPress={() => router.push({ pathname: "/report", params: { eventId: event.id, category: event.categoryCode } })} />
        ) : null}
        <FollowChip label={t("share")} on={false}
          onPress={() => void Share.share({ message: `${eventTitle(event, lang)}\n\n${shareUrl("event", event.id, LINK_DOMAIN)}` }).catch(() => undefined)} />
        <FollowChip label={t("nothingHere")} on={false}
          onPress={() => router.push({ pathname: "/report", params: { eventId: event.id, category: event.categoryCode, deny: "1" } })} />
        <FollowChip label={t("flag")} on={false} onPress={() => openFlag("EVENT", event.id)} />
        {institutions.filter((i) => canStateOn(i.scope, event)).map((i) => (
          <FollowChip key={i.handle} label={`${t("officialStatement")} · ${i.name}`} on={false} onPress={() => officialStatement(i.handle, i.name)} />
        ))}
        {institutions.filter((i) => canStateOn(i.scope, event)).map((i) => (
          <FollowChip key={`u-${i.handle}`} label={`${t("officialUpdate")} · ${i.name}`} on={false}
            onPress={() => router.push({ pathname: "/compose", params: { eventId: event.id, asBusiness: i.handle, official: "1" } })} />
        ))}
      </View>
      <Text style={[styles.badge, { backgroundColor: color }]}>{verificationLabel(event.publicVerificationState)}</Text>
      {/* Estado del ciclo de vida y gravedad (ADR 0222): independientes de la verificación. */}
      <Text style={styles.meta}>{eventStatusLine(event, t, tf)}</Text>
      <Text style={styles.meta}>
        {[
          ...evidenceCounts(event, tCount),
          // Hora del suceso y, si se supo mucho después, la de detección (ADR 0224).
          ...((w) => (w.detected ? [`${t("eventStarted")} ${w.started}`, `${t("eventDetected")} ${w.detected}`] : [w.started]))(
            eventWhenParts(event, (iso) => eventTime(iso, lang, event.place?.timezone, zoneLabels()))),
          // Hora de fin (ADR 0140), solo en eventos cerrados.
          ...(event.endedAt ? [`${t("eventEnded")} ${eventTime(event.endedAt, lang, event.place?.timezone, zoneLabels())}`] : []),
        ].join(" · ")}
      </Text>
      {verification ? (
        <View style={styles.why}>
          <Text style={styles.section}>{t("whyThisState")}</Text>
          {explainLines(verification, t, (iso) => formatInZone(iso, lang, event.place?.timezone ?? undefined, "time") ?? iso).map((line) => <Text key={line} style={styles.whyLine}>• {line}</Text>)}
          <Text style={styles.meta}>{evidenceLine(verification, t)}</Text>
        </View>
      ) : null}
      {sources.length > 0 ? (
        <View style={styles.why}>
          <Text style={styles.section}>{t("sourcesSection")}</Text>
          {sources.map((s) => (
            <Pressable key={s.sourceKey} accessibilityRole={s.link ? "link" : "text"} disabled={!s.link} style={styles.source}
              onPress={() => { if (s.link) void Linking.openURL(s.link); }}>
              <Text style={[styles.sourceName, s.link && styles.link]}>{s.sourceName} · {t(s.trustTier === "OFFICIAL" ? "tierOfficial" : "tierExternal")}</Text>
              {s.title ? <Text style={styles.entry}>{s.title[lang] ?? Object.values(s.title)[0]}</Text> : null}
              {s.assertion === "NOT_OCCURRING" ? <Text style={styles.retracted}>{t("sourceRetracted")}</Text> : null}
              <Text style={styles.sourceMeta}>{[s.publishedAt ? timeAgo(s.publishedAt, lang) : null, s.license].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {event.affectedArea ? <EventAreaMap area={event.affectedArea} point={event.point} color={categoryStyle(event.categoryCode).color} /> : null}
      <EventMedia
        media={media}
        onMore={mediaNext ? () => {
          const cursor = mediaNext;
          setMediaNext(null);
          api.eventMedia(id!, cursor).then((r) => { setMedia((m) => [...m, ...r.media]); setMediaNext(r.nextCursor ?? null); }).catch(() => setMediaNext(cursor));
        } : null}
      />
      <Text style={styles.section}>{t("timeline")}</Text>
      {/* Lo más reciente primero; lo anterior se pide por páginas. */}
      {newestFirst(timeline).map((item) => (
        <Text key={item.id} style={styles.entry}>{eventTime(item.at, lang, event?.place?.timezone, zoneLabels(), "time")} · {timelineLabel(item.type, t)}</Text>
      ))}
      {timelineNext && id ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void api.timeline(id, { order: "desc", limit: TIMELINE_SHOWN, cursor: timelineNext })
            .then((r) => { setTimeline((prev) => appendPage(prev, r.entries)); setTimelineNext(r.nextCursor ?? null); })
            .catch(() => undefined)}
        >
          <Text style={[styles.entry, styles.link]}>{t("showEarlier")}</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.section, styles.postsTitle]}>{t("eventPosts")}</Text>
    </View>
  );
  // Feed del evento (§5.3): reportes y publicaciones sobre él, debajo de la ficha.
  return (
    <View style={styles.container}>
      <FeedList tab="for_you" category={null} near={null} header={header} fetchPage={fetchPage} sourceKey={`event:${event.id}`}
        empty={<Text style={[styles.meta, styles.pad]}>{t("noEventPosts")}</Text>} />
    </View>
  );
}

function FollowChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={styles.chipText}>{on ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  follows: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginVertical: space.sm },
  chip: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  container: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16 },
  pad: { paddingHorizontal: 16 },
  postsTitle: { marginTop: space.lg },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  place: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  badge: { alignSelf: "flex-start", color: colors.white, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginVertical: 8, overflow: "hidden" },
  meta: { color: colors.textMuted, marginBottom: 16 },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: colors.text },
  entry: { paddingVertical: 6, color: colors.text },
  why: { marginBottom: space.sm },
  source: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  sourceName: { color: colors.text, fontWeight: "600" },
  link: { color: colors.link },
  retracted: { color: colors.accentText, fontWeight: "600" },
  sourceMeta: { color: colors.textMuted, fontSize: 12 },
  whyLine: { color: colors.text, marginBottom: 4 },
});

const zoneLabels = () => ({ local: t("eventLocalTime"), yours: t("yourTime") });
