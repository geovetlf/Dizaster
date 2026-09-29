import type { MediaView } from "@dizaster/contracts";
import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { t } from "../lib/i18n";
import { blurPreviewUri } from "../lib/ui/format";
import { colors } from "../theme";
import { Icon } from "./icon";

/**
 * Aviso de contenido sensible (ADR 0035): la media se ve difuminada con un aviso hasta que la persona toca.
 * El difuminado lo hace el sistema (blurRadius) igual en Android e iOS; no descarga nada extra.
 */
export function SensitiveCover({ m, style, children }: { m: MediaView; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (!m.contentWarning || shown) return <>{children}</>;
  const uri = blurPreviewUri(m);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("sensitiveContent")} accessibilityHint={t("tapToView")}
      onPress={() => setShown(true)} style={[style, styles.cover]}>
      {uri ? <Image source={{ uri }} blurRadius={40} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.veil} />
      <Icon name="eye-off-outline" size={26} color={colors.white} />
      <Text style={styles.title}>{t("sensitiveContent")}</Text>
      <Text style={styles.hint}>{t("tapToView")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#11161D", gap: 4, padding: 8 },
  veil: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#00000066" },
  title: { color: colors.white, fontWeight: "700", textAlign: "center" },
  hint: { color: colors.white, fontSize: 12, textAlign: "center" },
});
