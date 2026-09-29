import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import type { CategoryCatalog, CategoryConfig, GeoPoint, NearbyEvent, SubmitReportRequest, SubmitReportResponse } from "@dizaster/contracts";
import { clampToRadius } from "@dizaster/geo-kit";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { api, sendReport } from "../lib/api";
import { t, verificationLabel } from "../lib/i18n";
import { newId } from "../lib/ids";
import { OFFLINE_FALLBACK_STYLE, providerFromAppConfig } from "../lib/map/provider";
import { toPresenceSignals } from "../lib/report/presence";
import { ReportQueue } from "../lib/report/queue";
import { SqliteQueueStorage } from "../lib/report/sqlite-storage";
import { useSession } from "../lib/session";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require("../reference-data/categories.json") as CategoryCatalog;
const lang = Intl.DateTimeFormat().resolvedOptions().locale.startsWith("en") ? "en" : "es";
const queue = new ReportQueue(new SqliteQueueStorage());

type Phase = "category" | "locating" | "compose";

export default function ReportScreen() {
  const session = useSession();
  const categories = useMemo(
    () => catalog.categories.filter((c) => c.citizenReportable && !catalog.categories.some((x) => x.parent === c.code)),
    [],
  );
  const [phase, setPhase] = useState<Phase>("category");
  const [category, setCategory] = useState<CategoryConfig | null>(null);
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<NearbyEvent[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pseudonymous, setPseudonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = useRef<Location.LocationObject[]>([]);

  useEffect(() => {
    api.config().then((c) => setStyleUrl(providerFromAppConfig(c)?.styleUrl("light") ?? null)).catch(() => setStyleUrl(null));
  }, []);

  async function choose(c: CategoryConfig) {
    setCategory(c);
    setPhase("locating");
    setStatus(t("locating"));
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setStatus(t("locationDenied"));
      return;
    }
    // Ubicación del propio sistema operativo: gratis, sin API de mapas.
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    recent.current.push(loc);
    const here = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    setFix(loc);
    setPin(here);
    setStatus(null);
    setPhase("compose");
    api.nearby(here.lat, here.lng, c.code).then((r) => setNearby(r.events)).catch(() => setNearby([]));
  }

  function movePin(p: GeoPoint) {
    if (!fix || !category) return;
    // El pin solo puede moverse dentro del radio de presencia de la categoría.
    setPin(clampToRadius({ lat: fix.coords.latitude, lng: fix.coords.longitude }, p, category.presenceRadiusM));
  }

  async function submit() {
    if (!category || !fix || !pin) return;
    setBusy(true);
    try {
      const now = new Date();
      const body: SubmitReportRequest = {
        clientReportId: newId(),
        categoryCode: category.code,
        assertion: "OCCURRING",
        ...(text.trim() ? { text: text.trim() } : {}),
        mediaIds: [],
        pin,
        // La atestación real (App Attest / Play Integrity) se integra con la Identity Layer.
        presence: toPresenceSignals(fix, recent.current.slice(0, -1), null, now),
        capturedAt: new Date(fix.timestamp).toISOString(),
        capturedOffline: false,
        anonymityMode: pseudonymous || category.forcePseudonymous ? "PSEUDONYMOUS" : "PUBLIC",
        ...(session.deviceId ? { deviceId: session.deviceId } : {}),
        ...(target ? { targetEventId: target } : {}),
      };
      await queue.enqueue(body, now);
      setStatus(t("sending"));
      const result = await queue.flush(sendReport);
      const mine = result.sent[result.sent.length - 1];
      if (!mine) {
        setStatus(t("queuedOffline"));
        return;
      }
      setStatus(describe(mine));
      if ("eventId" in mine) router.replace(`/event/${mine.eventId}`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "category" || !category) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("chooseCategory")}</Text>
        <FlatList
          data={categories}
          keyExtractor={(c) => c.code}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => void choose(item)}>
              <Text style={styles.rowText}>{item.names[lang] ?? item.names["es"]}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  if (phase === "locating" || !pin || !fix) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{category.names[lang] ?? category.names["es"]}</Text>
        <Text style={styles.status}>{status}</Text>
      </View>
    );
  }

  const pinFeature: GeoJSON.Feature = { type: "Feature", geometry: { type: "Point", coordinates: [pin.lng, pin.lat] }, properties: {} };
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{category.names[lang] ?? category.names["es"]}</Text>
      {category.defaultSeverity >= 4 ? (
        <Pressable accessibilityRole="button" style={styles.callFirst} onPress={() => router.push("/emergency")}>
          <Text style={styles.callFirstText}>{t("callFirst")}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.note}>{t("adjustPin")}</Text>
      <View style={styles.mapBox}>
        <Map
          style={styles.map}
          mapStyle={styleUrl ?? OFFLINE_FALLBACK_STYLE}
          logo={false}
          onPress={(e) => {
            const [lng, lat] = e.nativeEvent.lngLat;
            movePin({ lat, lng });
          }}
        >
          <Camera initialViewState={{ center: [fix.coords.longitude, fix.coords.latitude], zoom: 16 }} />
          <GeoJSONSource id="pin" data={pinFeature}>
            <Layer id="pin-dot" type="circle" paint={{ "circle-radius": 9, "circle-color": "#c62828", "circle-stroke-width": 3, "circle-stroke-color": "#fff" }} />
          </GeoJSONSource>
        </Map>
      </View>

      {nearby.length > 0 ? (
        <View style={styles.nearby}>
          <Text style={styles.section}>{t("sameEvent")}</Text>
          {nearby.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" style={[styles.nearbyRow, target === e.id && styles.nearbySelected]} onPress={() => setTarget(e.id)}>
              <Text style={styles.rowText}>{e.title?.[lang] ?? e.title?.["es"] ?? e.categoryCode}</Text>
              <Text style={styles.meta}>{e.distanceBucket} · {verificationLabel(e.publicVerificationState)} · {e.reportCount} {t("reports")}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" style={[styles.nearbyRow, target === null && styles.nearbySelected]} onPress={() => setTarget(null)}>
            <Text style={styles.rowText}>{t("newEvent")}</Text>
          </Pressable>
        </View>
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
    </ScrollView>
  );
}

function describe(r: SubmitReportResponse): string {
  switch (r.outcome) {
    case "CREATED_EVENT": return t("created");
    case "ATTACHED_TO_EVENT": return t("attached");
    case "DOWNGRADED_TO_POST": return t("downgraded");
    case "REJECTED": return `${t("rejected")}: ${r.reason}`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, paddingHorizontal: 0 },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
  rowText: { fontSize: 16 },
  meta: { color: "#666", marginTop: 2 },
  mapBox: { height: 220, borderRadius: 12, overflow: "hidden", marginBottom: 12 },
  map: { flex: 1 },
  nearby: { marginBottom: 12 },
  nearbyRow: { padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, marginBottom: 8 },
  nearbySelected: { borderColor: "#1f2937", backgroundColor: "#f3f4f6" },
  input: { minHeight: 100, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, textAlignVertical: "top", marginBottom: 12 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  note: { color: "#555", marginBottom: 12 },
  callFirst: { backgroundColor: "#fdecea", padding: 12, borderRadius: 8, marginBottom: 12 },
  callFirstText: { color: "#b71c1c", fontWeight: "600" },
  send: { backgroundColor: "#1f2937", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  disabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  status: { marginTop: 16, fontSize: 15, paddingHorizontal: 16 },
});
