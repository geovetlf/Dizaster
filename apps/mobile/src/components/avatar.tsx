import { Image, StyleSheet, Text, View } from "react-native";
import { initials } from "../lib/ui/format";
import { colors, radius } from "../theme";

/**
 * Foto de perfil o logo (ADR 0119): la miniatura saneada del servidor o, sin ella, las iniciales. Los negocios van
 * en cuadrado redondeado y las personas en círculo, igual en Android e iOS. NO AI REQUIRED.
 */
export function Avatar({ name, url, size, square = false }: { name: string; url?: string | null; size: number; square?: boolean }) {
  const shape = { width: size, height: size, borderRadius: square ? radius.lg : size / 2 };
  if (url) return <Image source={{ uri: url }} style={[styles.box, shape]} resizeMode="cover" accessibilityIgnoresInvertColors accessible={false} />;
  return (
    <View style={[styles.box, shape]}>
      <Text style={[styles.text, { fontSize: Math.max(11, Math.round(size / 3)) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  text: { color: colors.text, fontWeight: "700" },
});
