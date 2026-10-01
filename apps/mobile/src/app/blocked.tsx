import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";
import { ErrorText } from "../components/error-text";

/** Personas y negocios bloqueados (ADR 0097), con "Desbloquear". */
export default function BlockedScreen() {
  const [handles, setHandles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.myBlocks().then((r) => setHandles(r.handles)).catch((e: Error) => setError(e.message)); }, []));

  async function unblock(handle: string) {
    try {
      await api.block(handle, false);
      setHandles((prev) => (prev ?? []).filter((h) => h !== handle));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={handles ?? []}
      keyExtractor={(h) => h}
      ListHeaderComponent={(
        <View style={{ gap: space.xs }}>
          <Text style={styles.meta}>{t("blockedHint")}</Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      )}
      ListEmptyComponent={handles ? <Text style={styles.meta}>{t("blockedEmpty")}</Text> : null}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.title}>@{item}</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void unblock(item)}>
            <Text style={styles.buttonText}>{t("unblock")}</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  title: { flex: 1, color: colors.text, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 13, marginBottom: space.sm },
  button: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  buttonText: { color: colors.white, fontWeight: "600" },
});
