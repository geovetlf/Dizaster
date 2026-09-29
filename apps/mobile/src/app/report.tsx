import type { CategoryCatalog, CategoryConfig, SubmitReportRequest, SubmitReportResponse } from "@dizaster/contracts";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { sendReport } from "../lib/api";
import { t } from "../lib/i18n";
import { newId } from "../lib/ids";
import { toPresenceSignals } from "../lib/report/presence";
import { ReportQueue } from "../lib/report/queue";
import { SqliteQueueStorage } from "../lib/report/sqlite-storage";
import { useSession } from "../lib/session";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;
const lang = Intl.DateTimeFormat().resolvedOptions().locale.startsWith("en") ? "en" : "es";
const queue = new ReportQueue(new SqliteQueueStorage());

export default function ReportScreen() {
  const session = useSession();
  const categories = useMemo(
    () => catalog.categories.filter((c) => c.citizenReportable && !catalog.categories.some((x) => x.parent === c.code)),
    [],
  );
  const [category, setCategory] = useState<CategoryConfig | null>(null);
  const [text, setText] = useState("");
  const [pseudonymous, setPseudonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = useRef<Location.LocationObject[]>([]);

  async function submit() {
    if (!category) return;
    setBusy(true);
    setStatus(t("locating"));
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setStatus(t("locationDenied"));
        return;
      }
      // Ubicación del propio sistema operativo: gratis, sin API de mapas.
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      recent.current.push(loc);
      const now = new Date();
      const body: SubmitReportRequest = {
        clientReportId: newId(),
        categoryCode: category.code,
        assertion: "OCCURRING",
        ...(text.trim() ? { text: text.trim() } : {}),
        mediaIds: [],
        // Pin = ubicación actual (el ajuste manual dentro del radio llega con la pantalla de pin).
        pin: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        // La atestación real (App Attest / Play Integrity) se integra en la etapa de seguridad.
        presence: toPresenceSignals(loc, recent.current.slice(0, -1), null, now),
        capturedAt: now.toISOString(),
        capturedOffline: false,
        anonymityMode: pseudonymous || category.forcePseudonymous ? "PSEUDONYMOUS" : "PUBLIC",
        ...(session.deviceId ? { deviceId: session.deviceId } : {}),
      };
      await queue.enqueue(body, now);
      setStatus(t("sending"));
      const result = await queue.flush(sendReport);
      const mine = result.sent.find((r) => "reportId" in r || "postId" in r);
      if (result.failed > 0 && !mine) {
        setStatus(t("queuedOffline"));
        return;
      }
      setStatus(describe(mine));
      if (mine && "eventId" in mine) router.replace(`/event/${mine.eventId}`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!category) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("chooseCategory")}</Text>
        <FlatList
          data={categories}
          keyExtractor={(c) => c.code}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => setCategory(item)}>
              <Text style={styles.rowText}>{item.names[lang] ?? item.names["es"]}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{category.names[lang] ?? category.names["es"]}</Text>
      {category.defaultSeverity >= 4 ? (
        <Pressable accessibilityRole="button" style={styles.callFirst} onPress={() => router.push("/emergency")}>
          <Text style={styles.callFirstText}>{t("callFirst")}</Text>
        </Pressable>
      ) : null}
      <TextInput style={styles.input} multiline maxLength={2000} value={text} onChangeText={setText} placeholder="…" />
      {category.forcePseudonymous ? (
        <Text style={styles.note}>{t("pseudonymousForced")}</Text>
      ) : (
        <View style={styles.switchRow}>
          <Text style={styles.rowText}>{t("pseudonymous")}</Text>
          <Switch value={pseudonymous} onValueChange={setPseudonymous} />
        </View>
      )}
      <Text style={styles.note}>{t("privacyNote")}</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.send, busy && styles.disabled]} onPress={() => void submit()}>
        <Text style={styles.sendText}>{busy ? t("sending") : t("send")}</Text>
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

function describe(r: SubmitReportResponse | undefined): string {
  if (!r) return t("queuedOffline");
  switch (r.outcome) {
    case "CREATED_EVENT": return t("created");
    case "ATTACHED_TO_EVENT": return t("attached");
    case "DOWNGRADED_TO_POST": return t("downgraded");
    case "REJECTED": return `${t("rejected")}: ${r.reason}`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
  rowText: { fontSize: 16 },
  input: { minHeight: 100, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, textAlignVertical: "top", marginBottom: 12 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  note: { color: "#555", marginBottom: 12 },
  callFirst: { backgroundColor: "#fdecea", padding: 12, borderRadius: 8, marginBottom: 12 },
  callFirstText: { color: "#b71c1c", fontWeight: "600" },
  send: { backgroundColor: "#1f2937", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  disabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  status: { marginTop: 16, fontSize: 15 },
});
