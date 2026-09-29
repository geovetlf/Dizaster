import type { EventSummary, TimelineEntryView } from "@dizaster/contracts";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { t, VERIFICATION_LABEL, verificationLabel } from "../../lib/i18n";

/** Pantalla de evento. También es el destino de los deep links: dizaster://event/<id> y https://<dominio>/e/<id>. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntryView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.event(id), api.timeline(id)])
      .then(([e, tl]) => { setEvent(e); setTimeline(tl.entries); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <Text style={styles.container}>{error}</Text>;
  if (!event) return <View style={styles.container} />;
  const color = VERIFICATION_LABEL[event.publicVerificationState]?.color ?? "#8a94a6";
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{event.title?.["es"] ?? event.categoryCode}</Text>
      <Text style={[styles.badge, { backgroundColor: color }]}>{verificationLabel(event.publicVerificationState)}</Text>
      <Text style={styles.meta}>
        {event.reportCount} {t("reports")} · {event.sourceCount} {t("sources")} · {new Date(event.firstSeenAt).toLocaleString()}
      </Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700" },
  badge: { alignSelf: "flex-start", color: "#fff", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginVertical: 8, overflow: "hidden" },
  meta: { color: "#555", marginBottom: 16 },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  entry: { paddingVertical: 6, color: "#333" },
});
