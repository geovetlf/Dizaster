import { StyleSheet, Text } from "react-native";
import { lang, t } from "../lib/i18n";
import { timeAgo } from "../lib/ui/format";
import { radius, space } from "../theme";

/** Aviso de que lo que se ve es la copia guardada en el teléfono porque no hay conexión (ADR 0066). */
export function OfflineNote({ savedAt }: { savedAt: number }) {
  return <Text style={styles.note}>{t("offlineCopy")} · {timeAgo(new Date(savedAt).toISOString(), lang)}</Text>;
}

const styles = StyleSheet.create({
  note: { backgroundColor: "#3A2A10", color: "#FACC15", padding: space.sm, borderRadius: radius.sm, marginBottom: space.sm, overflow: "hidden" },
});
