import type { RedactionBox } from "@dizaster/contracts";
import { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../lib/i18n";
import { useReduceMotion } from "../lib/a11y/announce";
import { BOX_SIZES, toggleBoxAt, type BoxSize } from "../lib/media/redaction";
import { colors, radius, space } from "../theme";

/**
 * Marcar rostros y matrículas para difuminar (ADR 0042). Tocar añade un recuadro; tocar un recuadro lo quita.
 * El difuminado real lo hace el servidor sobre lo que se publica; aquí solo se ve dónde irá.
 */
export function RedactEditor({ uri, width, height, boxes, onDone }: {
  uri: string; width: number | null; height: number | null; boxes: RedactionBox[]; onDone: (boxes: RedactionBox[] | null) => void;
}) {
  const win = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [draft, setDraft] = useState<RedactionBox[]>(boxes);
  const [size, setSize] = useState<BoxSize>("M");
  const ratio = width && height ? width / height : 4 / 3;
  const viewW = Math.min(win.width - space.lg * 2, (win.height * 0.62) * ratio);
  const viewH = viewW / ratio;

  return (
    <Modal visible animationType={reduceMotion ? "none" : "slide"} onRequestClose={() => onDone(null)}>
      <SafeAreaView style={styles.safe}>
        <Text style={styles.title}>{t("redactTitle")}</Text>
        <Text style={styles.note}>{t("redactHelp")}</Text>
        <Pressable
          accessibilityLabel={t("redactTitle")}
          onPress={(e) => setDraft((d) => toggleBoxAt(d, e.nativeEvent.locationX, e.nativeEvent.locationY, viewW, viewH, size))}
          style={{ width: viewW, height: viewH, alignSelf: "center" }}
        >
          <Image source={{ uri }} style={{ width: viewW, height: viewH }} resizeMode="cover" accessibilityIgnoresInvertColors />
          {draft.map((b, i) => (
            <View key={i} pointerEvents="none" style={[styles.box, { left: b.x * viewW, top: b.y * viewH, width: b.w * viewW, height: b.h * viewH }]} />
          ))}
        </Pressable>
        <View style={styles.sizes}>
          {(Object.keys(BOX_SIZES) as BoxSize[]).map((s) => (
            <Pressable key={s} accessibilityRole="button" accessibilityState={{ selected: s === size }} onPress={() => setSize(s)} style={[styles.chip, s === size && styles.chipOn]}>
              <Text style={styles.chipText}>{t(`redactSize${s}`)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => onDone(null)} style={styles.secondary}><Text style={styles.chipText}>{t("cancel")}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => onDone(draft)} style={styles.primary}>
            <Text style={styles.primaryText}>{draft.length > 0 ? `${t("redactDone")} (${draft.length})` : t("redactDone")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: space.sm },
  note: { color: colors.textMuted, marginBottom: space.md },
  box: { position: "absolute", backgroundColor: "#000000CC", borderWidth: 2, borderColor: colors.accent, borderRadius: 6 },
  sizes: { flexDirection: "row", gap: space.sm, marginTop: space.lg, justifyContent: "center" },
  chip: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "600" },
  actions: { flexDirection: "row", gap: space.md, marginTop: "auto" },
  secondary: { flex: 1, borderWidth: 1, borderColor: colors.text, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  primary: { flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  primaryText: { color: colors.white, fontWeight: "700" },
});
