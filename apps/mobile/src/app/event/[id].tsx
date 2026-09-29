import type { EventSummary, MediaView, TimelineEntryView } from "@dizaster/contracts";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { EventMedia } from "../../components/event-media";
import { api } from "../../lib/api";
import { t, VERIFICATION_LABEL, verificationLabel } from "../../lib/i18n";
import { followablePlace } from "../../lib/social/place";
import { useFollows } from "../../lib/social/follows";
import { colors, radius, space } from "../../theme";

/** Pantalla de evento. También es el destino de los deep links: dizaster://event/<id> y https://<dominio>/e/<id>. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntryView[]>([]);
  const [media, setMedia] = useState<MediaView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const follows = useFollows();

  useEffect(() => {
    if (!id) return;
    Promise.all([api.event(id), api.timeline(id)])
      .then(([e, tl]) => { setEvent(e); setTimeline(tl.entries); })
      .catch((e: Error) => setError(e.message));
    // La media es secundaria: si falla, el evento se muestra igual.
    api.eventMedia(id).then((r) => setMedia(r.media)).catch(() => setMedia([]));
  }, [id]);

  if (error) return <Text style={[styles.container, styles.entry]}>{error}</Text>;
  if (!event) return <View style={styles.container} />;
  const color = VERIFICATION_LABEL[event.publicVerificationState]?.color ?? "#8a94a6";
  const place = followablePlace(event.place);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{event.title?.["es"] ?? event.categoryCode}</Text>
      {event.place ? <Text style={styles.place}>{event.place.label}</Text> : null}
      <View style={styles.follows}>
        <FollowChip label={t("followEvent")} on={follows.following("event", event.id)} onPress={() => void follows.toggle("event", event.id)} />
        {place ? (
          <FollowChip label={`${t("followPlace")} ${place.name}`} on={follows.following("place", place.id)} onPress={() => void follows.toggle("place", place.id, place.name)} />
        ) : null}
      </View>
      <Text style={[styles.badge, { backgroundColor: color }]}>{verificationLabel(event.publicVerificationState)}</Text>
      <Text style={styles.meta}>
        {event.reportCount} {t("reports")} · {event.sourceCount} {t("sources")} · {new Date(event.firstSeenAt).toLocaleString()}
      </Text>
      <EventMedia media={media} />
      <Text style={styles.section}>{t("timeline")}</Text>
      <FlatList
        data={timeline}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <Text style={styles.entry}>{new Date(item.at).toLocaleTimeString()} · {item.type}</Text>
        )}
      />
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
  container: { flex: 1, padding: 16, backgroundColor: colors.bg },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  place: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  badge: { alignSelf: "flex-start", color: colors.white, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginVertical: 8, overflow: "hidden" },
  meta: { color: colors.textMuted, marginBottom: 16 },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: colors.text },
  entry: { paddingVertical: 6, color: colors.text },
});
