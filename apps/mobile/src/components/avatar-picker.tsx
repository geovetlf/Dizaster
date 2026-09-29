import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../lib/i18n";
import { pickProcessedImage } from "../lib/media/avatar-pick";
import { colors, radius, space } from "../theme";
import { Avatar } from "./avatar";

/**
 * Cambiar o quitar la foto de perfil o el logo (ADR 0119). Se aplica al momento (no espera a "Guardar"):
 * `apply` fija la imagen en el servidor y devuelve la URL nueva. Mismo flujo en Android e iOS.
 */
export function AvatarPicker({ name, url, square = false, apply }: {
  name: string; url: string | null; square?: boolean; apply: (mediaId: string | null) => Promise<string | null>;
}) {
  const [current, setCurrent] = useState(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(pick: boolean) {
    setBusy(true);
    setError(null);
    try {
      const mediaId = pick ? await pickProcessedImage() : null;
      if (pick && !mediaId) return;
      setCurrent(await apply(mediaId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Avatar name={name} url={current} size={72} square={square} />
      <View style={styles.side}>
        {busy ? <ActivityIndicator color={colors.accent} /> : (
          <View style={styles.row}>
            <Pressable accessibilityRole="button" onPress={() => void run(true)} style={styles.button}>
              <Text style={styles.buttonText}>{t(current ? "avatarChange" : "avatarAdd")}</Text>
            </Pressable>
            {current ? (
              <Pressable accessibilityRole="button" onPress={() => void run(false)} style={styles.button}>
                <Text style={styles.buttonText}>{t("remove")}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <Text style={styles.hint}>{t("avatarHint")}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  side: { flex: 1, gap: space.xs },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  button: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  buttonText: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.like },
});
