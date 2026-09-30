import { mediaAvailability } from "@dizaster/contracts";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { t, type MessageKey } from "../lib/i18n";
import { captureMedia, discardLocal, type CaptureKind, type CaptureSource } from "../lib/media/capture";
import { checkLimits, type LocalMedia } from "../lib/media/local-media";
import { colors } from "../theme";
import { RedactEditor } from "./redact-editor";

export const MAX_MEDIA_PER_REPORT = 4;

/** Adjuntar fotos y videos a un reporte. Mismo componente en Android e iOS. */
export function MediaAttachments({ items, onChange, suggestRedaction = false, cameraOnly = false }: {
  items: LocalMedia[]; onChange: (items: LocalMedia[]) => void;
  /** Reportes (D-10, ADR 0166): solo la cámara de la app; la galería queda para los posts. */
  cameraOnly?: boolean;
  /** Categoría sensible (p. ej. delincuencia): se invita a difuminar rostros y matrículas (D-08). */
  suggestRedaction?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LocalMedia | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const full = items.length >= MAX_MEDIA_PER_REPORT;
  // Kill switches remotos (ADR 0082): sin red se muestran las opciones y el servidor decide al subir.
  const [avail, setAvail] = useState({ photo: true, video: true });
  useEffect(() => {
    api.config().then((c) => setAvail(mediaAvailability(c.killSwitches))).catch(() => undefined);
  }, []);

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

  function setGraphic(m: LocalMedia, graphic: boolean) {
    onChange(items.map((x) => (x.localUri === m.localUri ? { ...x, graphic } : x)));
  }

  function setRedactions(m: LocalMedia, redactions: LocalMedia["redactions"]) {
    onChange(items.map((x) => (x.localUri === m.localUri ? { ...x, redactions } : x)));
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
              <Pressable accessibilityRole="button" accessibilityLabel={t("redactTitle")} onPress={() => setEditing(m)}>
                <Image source={{ uri: m.localUri }} style={styles.image} accessibilityIgnoresInvertColors />
                {/* La miniatura va recortada: se indica cuántas zonas se difuminarán en lugar de dibujarlas. */}
                <View style={[styles.blurBadge, (suggestRedaction || (m.redactions ?? []).length > 0) && styles.blurBadgeOn]}>
                  <Text style={styles.removeText}>{(m.redactions ?? []).length || "◐"}</Text>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.image, styles.video]}>
                {m.poster ? <Image source={{ uri: m.poster.localUri }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
                <Text style={styles.videoText}>▶ {Math.round((m.durationMs ?? 0) / 1000)} s</Text>
              </View>
            )}
            <Pressable accessibilityRole="switch" accessibilityLabel={t("markGraphic")} accessibilityState={{ checked: !!m.graphic }}
              style={[styles.graphic, m.graphic && styles.graphicOn]} onPress={() => setGraphic(m, !m.graphic)}>
              <Text style={styles.removeText}>⚠</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} style={styles.remove} onPress={() => remove(m)}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.buttons}>
        {avail.photo ? <Button label={t("addPhoto")} disabled={busy || full} onPress={() => void add("camera", "IMAGE")} /> : null}
        {avail.video ? <Button label={t("addVideo")} disabled={busy || full} onPress={() => void add("camera", "VIDEO_RECORDED")} /> : null}
        {avail.photo && !cameraOnly ? <Button label={t("fromGallery")} disabled={busy || full} onPress={() => void add("library", "IMAGE")} /> : null}
      </View>
      {!avail.photo ? <Text style={styles.note}>{t("mediaPaused")}</Text> : !avail.video ? <Text style={styles.note}>{t("videoPaused")}</Text> : null}
      {cameraOnly ? <Text style={styles.note}>{t("cameraOnlyHint")}</Text> : null}
      {items.length > 0 ? <Text style={styles.note}>{t("graphicHint")}</Text> : null}
      {items.some((m) => m.kind === "IMAGE") ? <Text style={[styles.note, suggestRedaction && styles.warn]}>{t(suggestRedaction ? "redactSuggest" : "redactHint")}</Text> : null}
      {editing ? (
        <RedactEditor uri={editing.localUri} width={editing.width} height={editing.height} boxes={editing.redactions ?? []}
          onDone={(boxes) => { if (boxes) setRedactions(editing, boxes); setEditing(null); }} />
      ) : null}
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
  remove: { position: "absolute", top: -6, end: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  removeText: { color: colors.white, fontSize: 12 },
  graphic: { position: "absolute", bottom: -6, end: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", opacity: 0.6 },
  blurBadge: { position: "absolute", bottom: -6, start: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", opacity: 0.6 },
  blurBadgeOn: { backgroundColor: colors.accent, opacity: 1 },
  warn: { color: colors.text, fontWeight: "600" },
  graphicOn: { backgroundColor: colors.accent, opacity: 1 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, borderWidth: 1, borderColor: colors.text, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  buttonText: { color: colors.text, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  note: { color: colors.textMuted, marginTop: 8 },
});
