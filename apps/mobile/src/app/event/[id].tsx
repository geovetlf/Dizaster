import type { EventSummary, MediaView, TimelineEntryView, VerificationView } from "@dizaster/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FeedList } from "../../components/feed-list";
import { EventMedia } from "../../components/event-media";
import { api } from "../../lib/api";
import { lang, t, VERIFICATION_LABEL, verificationLabel } from "../../lib/i18n";
import { eventTitle } from "../../lib/ui/format";
import { evidenceLine, explainLines, timelineLabel } from "../../lib/verification/explain";
import { followablePlace } from "../../lib/social/place";
import { useFollows } from "../../lib/social/follows";
import { openFlag } from "../../lib/moderation/menu";
import { colors, radius, space } from "../../theme";

const TIMELINE_SHOWN = 12;

/** Pantalla de evento. También es el destino de los deep links: dizaster://event/<id> y https://<dominio>/e/<id>. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntryView[]>([]);
  const [media, setMedia] = useState<MediaView[]>([]);
  const [verification, setVerification] = useState<VerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const follows = useFollows();

  useEffect(() => {
    if (!id) return;
    Promise.all([api.event(id), api.timeline(id)])
      .then(([e, tl]) => { setEvent(e); setTimeline(tl.entries); })
      .catch((e: Error) => setError(e.message));
    // La media es secundaria: si falla, el evento se muestra igual.
    api.eventMedia(id).then((r) => setMedia(r.media)).catch(() => setMedia([]));
    api.verification(id).then(setVerification).catch(() => setVerification(null));
  }, [id]);

  const fetchPage = useCallback((cursor: string | null) => api.eventPosts(id ?? "", cursor), [id]);

  if (error) return <Text style={[styles.container, styles.header, styles.entry]}>{error}</Text>;
  if (!event) return <View style={styles.container} />;
  const color = VERIFICATION_LABEL[event.publicVerificationState]?.color ?? "#8a94a6";
  const place = followablePlace(event.place);
  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{eventTitle(event, lang)}</Text>
      {event.place ? <Text style={styles.place}>{event.place.label}</Text> : null}
      <View style={styles.follows}>
        <FollowChip label={t("followEvent")} on={follows.following("event", event.id)} onPress={() => void follows.toggle("event", event.id)} />
        {place ? (
          <FollowChip label={`${t("followPlace")} ${place.name}`} on={follows.following("place", place.id)} onPress={() => void follows.toggle("place", place.id, place.name)} />
        ) : null}
        <FollowChip label={t("postAboutThis")} on={false} onPress={() => router.push({ pathname: "/compose", params: { eventId: event.id } })} />
        <FollowChip label={t("nothingHere")} on={false}
          onPress={() => router.push({ pathname: "/report", params: { eventId: event.id, category: event.categoryCode, deny: "1" } })} />
        <FollowChip label={t("flag")} on={false} onPress={() => openFlag("EVENT", event.id)} />
      </View>
      <Text style={[styles.badge, { backgroundColor: color }]}>{verificationLabel(event.publicVerificationState)}</Text>
      <Text style={styles.meta}>
        {event.reportCount} {t("reports")} · {event.sourceCount} {t("sources")} · {new Date(event.firstSeenAt).toLocaleString()}
      </Text>
      {verification ? (
        <View style={styles.why}>
          <Text style={styles.section}>{t("whyThisState")}</Text>
          {explainLines(verification, t).map((line) => <Text key={line} style={styles.whyLine}>• {line}</Text>)}
          <Text style={styles.meta}>{evidenceLine(verification, t)}</Text>
        </View>
      ) : null}
      <EventMedia media={media} />
      <Text style={styles.section}>{t("timeline")}</Text>
      {/* Lo más reciente primero; la historia completa vive en el servidor. */}
      {timeline.slice(-TIMELINE_SHOWN).reverse().map((item) => (
        <Text key={item.id} style={styles.entry}>{new Date(item.at).toLocaleTimeString()} · {timelineLabel(item.type, t)}</Text>
      ))}
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
  whyLine: { color: colors.text, marginBottom: 4 },
});
