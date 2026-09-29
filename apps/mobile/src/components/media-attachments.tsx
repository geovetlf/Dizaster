import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { t, type MessageKey } from "../lib/i18n";
import { captureMedia, discardLocal, type CaptureKind, type CaptureSource } from "../lib/media/capture";
import { checkLimits, type LocalMedia } from "../lib/media/local-media";
import { colors } from "../theme";

export const MAX_MEDIA_PER_REPORT = 4;

/** Adjuntar fotos y videos a un reporte. Mismo componente en Android e iOS. */
export function MediaAttachments({ items, onChange }: { items: LocalMedia[]; onChange: (items: LocalMedia[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const full = items.length >= MAX_MEDIA_PER_REPORT;

  async function add(source: CaptureSource, kind: CaptureKind) {
    if (full) return setMessage(t("maxMedia"));
    setBusy(true);
    setMessage(t("preparing"));
    try {
      const m = await captureMedia(source, kind);
      if (!m) return setMessage(null);
      const problem = checkLimits(m);
      if (problem) {
        discardLocal(m);
        return setMessage(t(problem as MessageKey));
      }
      onChange([...items, m]);
      setMessage(source === "library" ? t("galleryNote") : null);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove(m: LocalMedia) {
    discardLocal(m);
    onChange(items.filter((x) => x.localUri !== m.localUri));
  }

  return (
    <View style={styles.box}>
      <Text style={styles.section}>{t("media")}</Text>
      <View style={styles.thumbs}>
        {items.map((m) => (
          <View key={m.localUri} style={styles.thumb}>
            {m.kind === "IMAGE" ? (
              <Image source={{ uri: m.localUri }} style={styles.image} accessibilityIgnoresInvertColors />
            ) : (
              <View style={[styles.image, styles.video]}>
                {m.poster ? <Image source={{ uri: m.poster.localUri }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
                <Text style={styles.videoText}>▶ {Math.round((m.durationMs ?? 0) / 1000)} s</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} style={styles.remove} onPress={() => remove(m)}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.buttons}>
        <Button label={t("addPhoto")} disabled={busy || full} onPress={() => void add("camera", "IMAGE")} />
        <Button label={t("addVideo")} disabled={busy || full} onPress={() => void add("camera", "VIDEO_RECORDED")} />
        <Button label={t("fromGallery")} disabled={busy || full} onPress={() => void add("library", "IMAGE")} />
      </View>
      {message ? <Text style={styles.note}>{message}</Text> : null}
    </View>
  );
}

function Button({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} style={[styles.button, disabled && styles.disabled]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { marginBottom: 12 },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: colors.text },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  thumb: { width: 76, height: 76 },
  image: { width: 76, height: 76, borderRadius: 8 },
  video: { backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  videoText: { color: colors.white, fontWeight: "600" },
  remove: { position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  removeText: { color: colors.white, fontSize: 12 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, borderWidth: 1, borderColor: colors.text, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  buttonText: { color: colors.text, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  note: { color: colors.textMuted, marginTop: 8 },
});
