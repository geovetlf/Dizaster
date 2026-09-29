import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FeedList } from "../../components/feed-list";
import { t } from "../../lib/i18n";
import { colors, radius, space } from "../../theme";

/** Videos: publicaciones con video (el reproductor se abre al entrar al evento; no se autorreproduce: ahorra datos). */
export default function VideosScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FeedList
        tab="videos"
        category={null}
        near={null}
        header={<Text style={styles.title}>{t("videos")}</Text>}
        empty={<View style={styles.empty}><Text style={styles.emptyText}>{t("noVideos")}</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginVertical: space.lg },
  empty: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl },
  emptyText: { color: colors.textMuted, textAlign: "center" },
});
