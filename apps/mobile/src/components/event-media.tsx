import type { MediaView } from "@dizaster/contracts";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { t } from "../lib/i18n";
import { duration, imageUri } from "../lib/ui/format";
import { SensitiveCover } from "./sensitive-cover";

/** Galería pública de un evento: solo variantes saneadas que el servidor ya aprobó para mostrar. */
export function EventMedia({ media }: { media: MediaView[] }) {
  if (media.length === 0) return null;
  return (
    <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.content} showsHorizontalScrollIndicator={false}>
      {media.map((m) => (
        <SensitiveCover key={m.id} m={m} style={[styles.item, aspect(m)]}>
          {m.kind === "IMAGE" ? <Photo m={m} /> : <Video m={m} />}
        </SensitiveCover>
      ))}
    </ScrollView>
  );
}

/** En la tira, la miniatura; la imagen grande solo se descarga al abrirla (ADR 0188, ahorra datos). */
function Photo({ m }: { m: MediaView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={t("viewPhoto")} onPress={() => setOpen(true)}>
        <Image source={{ uri: imageUri(m, "small") }} style={[styles.item, aspect(m)]} resizeMode="cover" accessibilityIgnoresInvertColors />
      </Pressable>
      {open ? (
        <Modal visible animationType="fade" onRequestClose={() => setOpen(false)} supportedOrientations={["portrait", "landscape"]}>
          <View style={styles.viewer}>
            <Image source={{ uri: imageUri(m, "large") }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors />
            <Pressable accessibilityRole="button" accessibilityLabel={t("close")} hitSlop={12} onPress={() => setOpen(false)} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </>
  );
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
  viewer: { flex: 1, backgroundColor: "#000000" },
  closeBtn: { position: "absolute", top: 48, end: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center" },
  closeText: { color: "#FFFFFF", fontSize: 18 },
  duration: { position: "absolute", end: 8, bottom: 8, color: "#FFFFFF", backgroundColor: "#000000AA", paddingHorizontal: 6, borderRadius: 4, fontSize: 12 },
});
