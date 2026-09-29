import type { MediaView } from "@dizaster/contracts";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { t } from "../lib/i18n";
import { duration } from "../lib/ui/format";

/** Galería pública de un evento: solo variantes saneadas que el servidor ya aprobó para mostrar. */
export function EventMedia({ media }: { media: MediaView[] }) {
  if (media.length === 0) return null;
  return (
    <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.content} showsHorizontalScrollIndicator={false}>
      {media.map((m) => (m.kind === "IMAGE" ? <Photo key={m.id} m={m} /> : <Video key={m.id} m={m} />))}
    </ScrollView>
  );
}

function Photo({ m }: { m: MediaView }) {
  return <Image source={{ uri: m.url }} style={[styles.item, aspect(m)]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

/** Se muestra el póster y el video solo se carga al tocar: ahorra datos móviles (cost-first). */
function Video({ m }: { m: MediaView }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <Player m={m} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("playVideo")} onPress={() => setPlaying(true)} style={[styles.item, styles.video, aspect(m)]}>
      {m.posterUrl ? <Image source={{ uri: m.posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.play}><Text style={styles.playText}>▶</Text></View>
      <Text style={styles.duration}>{duration(m.durationMs)}</Text>
    </Pressable>
  );
}

function Player({ m }: { m: MediaView }) {
  // Reproducción progresiva del MP4/MOV (sin transcodificar en V1).
  const player = useVideoPlayer(m.url, (p) => { p.loop = false; p.play(); });
  return (
    <View style={[styles.item, aspect(m)]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="cover" />
    </View>
  );
}

const aspect = (m: MediaView) => ({ width: m.width && m.height ? Math.min(260, Math.round((180 * m.width) / m.height)) : 180 });

const styles = StyleSheet.create({
  strip: { marginBottom: 16, flexGrow: 0 },
  content: { gap: 8 },
  item: { height: 180, borderRadius: 10, overflow: "hidden", backgroundColor: "#eee" },
  video: { alignItems: "center", justifyContent: "center", backgroundColor: "#11161D" },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center" },
  playText: { color: "#FFFFFF", fontSize: 20 },
  duration: { position: "absolute", right: 8, bottom: 8, color: "#FFFFFF", backgroundColor: "#000000AA", paddingHorizontal: 6, borderRadius: 4, fontSize: 12 },
});
