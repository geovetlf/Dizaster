import type { Attribution, AttributionKind } from "@dizaster/contracts";
import * as Application from "expo-application";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { LIBRARIES, groupAttributions } from "../lib/about/libraries";
import { clearErrorLog, readErrorLog } from "../lib/errors/error-store";
import { t } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const TITLES: Record<AttributionKind, "aboutMap" | "aboutGeo" | "aboutTimezone" | "aboutSources"> = {
  MAP: "aboutMap",
  GEO: "aboutGeo",
  TIMEZONE: "aboutTimezone",
  SOURCE: "aboutSources",
};

/**
 * Acerca de / licencias (Blueprint §11.3, ADR 0051): atribuciones de datos que da el servidor (mapa ODbL, límites,
 * zonas horarias, fuentes) y el software libre de la app. Sin conexión muestra al menos la parte local.
 */
export default function AboutScreen() {
  const [list, setList] = useState<Attribution[]>([]);
  useEffect(() => { api.attributions().then((r) => setList(r.attributions)).catch(() => undefined); }, []);
  // Registro local de errores (ADR 0161): para contarlo a soporte; no sale del teléfono.
  const [errors, setErrors] = useState(readErrorLog);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{t("aboutIntro")}</Text>
      {groupAttributions(list).map((g) => (
        <View key={g.kind} style={styles.group}>
          <Text style={styles.heading}>{t(TITLES[g.kind])}</Text>
          {g.items.map((a) => <Item key={a.id} title={a.attribution} meta={a.license} url={a.url} />)}
        </View>
      ))}
      <View style={styles.group}>
        <Text style={styles.heading}>{t("aboutSoftware")}</Text>
        {LIBRARIES.map((l) => <Item key={l.name} title={l.name} meta={l.license} url={l.url} />)}
      </View>
      {errors.length ? (
        <View style={styles.group}>
          <Text style={styles.heading}>{t("errorLogTitle")}</Text>
          {errors.slice(0, 5).map((e) => <Item key={e.at} title={e.message} meta={`${e.at.slice(0, 16).replace("T", " ")}${e.requestId ? ` · ${e.requestId}` : ""}`} url={null} />)}
          <Pressable accessibilityRole="button" onPress={() => { clearErrorLog(); setErrors([]); }}>
            <Text style={styles.clear}>{t("errorLogClear")}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.version}>Dizaster {Application.nativeApplicationVersion ?? ""}</Text>
    </ScrollView>
  );
}

function Item({ title, meta, url }: { title: string; meta: string; url: string | null }) {
  return (
    <Pressable accessibilityRole={url ? "link" : "text"} disabled={!url} style={styles.row} onPress={() => { if (url) void Linking.openURL(url); }}>
      <Text style={[styles.title, url && styles.link]}>{title}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg },
  intro: { color: colors.textMuted, fontSize: 14 },
  group: { gap: space.sm },
  heading: { color: colors.text, fontSize: 16, fontWeight: "700" },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  title: { color: colors.text, fontSize: 14 },
  link: { color: colors.accentText },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  version: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  clear: { color: colors.accentText, paddingVertical: 8 },
});
