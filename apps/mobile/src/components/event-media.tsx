import type { MediaView } from "@dizaster/contracts";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image, ScrollView, StyleSheet, View } from "react-native";

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

function Video({ m }: { m: MediaView }) {
  // Reproducción progresiva del MP4/MOV (sin transcodificar en V1). No arranca sola: ahorra datos.
  const player = useVideoPlayer(m.url, (p) => { p.loop = false; });
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
});
