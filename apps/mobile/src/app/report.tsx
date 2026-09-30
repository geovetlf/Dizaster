import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import { detectPersonalData, type CategoryConfig, type GeoPoint, type NearbyEvent, type SubmitReportRequest, type SubmitReportResponse } from "@dizaster/contracts";
import { clampToRadius } from "@dizaster/geo-kit";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MediaAttachments } from "../components/media-attachments";
import { api } from "../lib/api";
import { callTarget, label as serviceLabel, type CallTarget } from "../lib/emergency";
import { localEmergencyDataset } from "../lib/emergency-store";
import { countryOf } from "../lib/geo/country";
import { quickCountry } from "../lib/geo/device-country";
import { FIX_TIMEOUT_MS, withTimeout } from "../lib/async/timeout";
import { lang, locale, t, tCount, verificationLabel } from "../lib/i18n";
import { formatInZone } from "../lib/ui/format";
import { newId } from "../lib/ids";
import { APP_MAP_SCHEME, OFFLINE_FALLBACK_STYLE, providerFromAppConfig } from "../lib/map/provider";
import { toPresenceSignals } from "../lib/report/presence";
import { signEvidence } from "../lib/report/evidence";
import { signingSeed } from "../lib/device/signing-key";
import type { LocalMedia } from "../lib/media/local-media";
import { flushUntilSent, reportQueue } from "../lib/report/outbox";
import { useSession } from "../lib/session";
import { outcomeLines } from "../lib/report/outcome";
import { colors } from "../theme";
import { categoryIn, findCategory, reportCategories, useCategoryCatalogVersion } from "../lib/category-store";
import { askSameEvent } from "../lib/report/same-event";
import { UpdateRequired, useUpdateRequirement } from "../components/update-required";
import { appConfig } from "../lib/config/app-config";


type Phase = "category" | "locating" | "compose";

export default function ReportScreen() {
  const session = useSession();
  // "Aquí no pasa nada" desde un evento: contra-reporte presencial sobre ese evento (Blueprint §10.2).
  const params = useLocalSearchParams<{ eventId?: string; category?: string; deny?: string }>();
  const deny = params.deny === "1" && !!params.eventId;
  const catalogVersion = useCategoryCatalogVersion();
  const categories = useMemo(() => reportCategories(), [catalogVersion]);
  const [phase, setPhase] = useState<Phase>("category");
  const [category, setCategory] = useState<CategoryConfig | null>(null);
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<NearbyEvent[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [pseudonymous, setPseudonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [call, setCall] = useState<CallTarget>({ kind: "list" });
  // Por qué no hay fix (ADR 0183): sin permiso (ir a Ajustes) o sin señal a tiempo (reintentar).
  const [blocked, setBlocked] = useState<"denied" | "timeout" | null>(null);
  const recent = useRef<Location.LocationObject[]>([]);
  // Versión por debajo de la mínima (ADR 0164): no se envía; emergencias sigue a mano.
  const update = useUpdateRequirement();

  useEffect(() => {
    if (!deny) return;
    const c = findCategory(params.category ?? "");
    if (!c?.citizenReportable) return;
    setTarget(params.eventId ?? null);
    void choose(c);
    // Solo al abrir la pantalla desde el evento.
  }, []);

  useEffect(() => {
    appConfig().then((c) => setStyleUrl(providerFromAppConfig(c)?.styleUrl(APP_MAP_SCHEME) ?? null)).catch(() => setStyleUrl(null));
  }, []);

  async function choose(picked: CategoryConfig) {
    let c = picked;
    setCategory(c);
    setPhase("locating");
    setStatus(t("locating"));
    setBlocked(null);
    // Riesgo vital (§8.1, ADR 0183): el botón de llamada sale YA, con el país de la SIM, el perfil o la región;
    // no espera al GPS. Con el fix se afina.
    if (!deny && c.defaultSeverity >= 4) {
      Promise.all([localEmergencyDataset(), quickCountry()])
        .then(([ds, where]) => setCall(callTarget(ds, c.code, where.country)))
        .catch(() => setCall({ kind: "list" }));
    }
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setStatus(t("locationDenied"));
      setBlocked("denied");
      return;
    }
    // Ubicación del propio sistema operativo: gratis, sin API de mapas. Bajo techo puede no llegar: tiempo límite.
    const loc = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }), FIX_TIMEOUT_MS).catch(() => null);
    if (!loc) {
      setStatus(t("locationTimeout"));
      setBlocked("timeout");
      return;
    }
    recent.current.push(loc);
    const here = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    // Los ajustes que rigen son los del país donde está la persona (radio de presencia, etc.; ADR 0152).
    const local = categoryIn(c.code, countryOf(here));
    if (!local?.citizenReportable) {
      setCategory(null);
      setPhase("category");
      setStatus(t("categoryNotHere"));
      return;
    }
    c = local;
    setCategory(c);
    setFix(loc);
    setPin(here);
    setStatus(null);
    setPhase("compose");
    if (c.defaultSeverity >= 4) {
      // País calculado en el teléfono; la ubicación no sale para esto.
      localEmergencyDataset().then((ds) => setCall(callTarget(ds, c.code, countryOf(here)))).catch(() => setCall({ kind: "list" }));
    }
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
        assertion: deny ? "NOT_OCCURRING" : "OCCURRING",
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
      // Firma de la captura (ADR 0129): antes de guardar en la cola, con los hashes de las fotos y videos.
      // Si el almacén seguro falla, el reporte sale igual sin firma: nunca se bloquea un aviso.
      const evidence = await signingSeed().then((seed) => signEvidence(body, media.map((m) => m.sha256), seed)).catch(() => undefined);
      await reportQueue.enqueue(evidence ? { ...body, evidence } : body, now, media);
      setMedia([]);
      setStatus(media.length ? t("uploadingMedia") : t("sending"));
      const mine = await flushUntilSent(body.clientReportId);
      if (!mine) {
        setStatus(t("queuedOffline"));
        return;
      }
      setStatus(describe(mine));
      if (mine.outcome === "ATTACHED_TO_EVENT" && mine.askSameEvent) askSameEvent(mine.reportId);
      if ("eventId" in mine) router.replace(`/event/${mine.eventId}`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (update.required) return <UpdateRequired storeUrl={update.storeUrl} />;

  if (phase === "category" || !category) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("chooseCategory")}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.replace("/compose")}>
          <Text style={styles.rowText}>{t("postWithoutReport")}</Text>
          <Text style={styles.meta}>{t("postWithoutReportHint")}</Text>
        </Pressable>
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

  const cat = category;
  const callFirst = !deny && cat.defaultSeverity >= 4 ? (
    <View style={styles.callFirst}>
      <Text style={styles.callFirstText}>{t("callFirst")}</Text>
      {call.kind === "direct" ? (
        <Pressable accessibilityRole="button" style={styles.callButton} onPress={() => void Linking.openURL(call.tel)}>
          <Text style={styles.callButtonText}>{t("callNow")} {serviceLabel(call.number, locale)} · {call.number.number}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => router.push("/emergency")}>
        <Text style={styles.callLink}>{call.kind === "direct" ? t("allNumbers") : t("emergencyTitle")}</Text>
      </Pressable>
    </View>
  ) : null;

  if (phase === "locating" || !pin || !fix) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{cat.names[lang] ?? cat.names["es"]}</Text>
        {callFirst}
        <Text style={styles.status}>{status}</Text>
        {blocked === "denied" ? (
          <Pressable accessibilityRole="button" style={styles.row} onPress={() => void Linking.openSettings()}>
            <Text style={styles.rowText}>{t("openSettings")}</Text>
          </Pressable>
        ) : null}
        {blocked === "timeout" ? (
          <Pressable accessibilityRole="button" style={styles.row} onPress={() => void choose(cat)}>
            <Text style={styles.rowText}>{t("retry")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const pinFeature: GeoJSON.Feature = { type: "Feature", geometry: { type: "Point", coordinates: [pin.lng, pin.lat] }, properties: {} };
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{category.names[lang] ?? category.names["es"]}</Text>
      {deny ? (
        <View style={styles.nearby}>
          <Text style={styles.section}>{t("denyTitle")}</Text>
          <Text style={styles.note}>{t("denyHint")}</Text>
        </View>
      ) : null}
      {callFirst}

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

      {!deny && nearby.length > 0 ? (
        <View style={styles.nearby}>
          <Text style={styles.section}>{t("sameEvent")}</Text>
          {nearby.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" style={[styles.nearbyRow, target === e.id && styles.nearbySelected]} onPress={() => setTarget(e.id)}>
              <Text style={styles.rowText}>{e.title?.[lang] ?? e.title?.["es"] ?? e.categoryCode}</Text>
              <Text style={styles.meta}>{e.distanceBucket} · {verificationLabel(e.publicVerificationState)} · {tCount(e.reportCount, "report_one", "reports")}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" style={[styles.nearbyRow, target === null && styles.nearbySelected]} onPress={() => setTarget(null)}>
            <Text style={styles.rowText}>{t("newEvent")}</Text>
          </Pressable>
        </View>
      ) : null}

      <MediaAttachments items={media} onChange={setMedia} suggestRedaction={category.sensitivity !== "NORMAL"} cameraOnly />
      <TextInput style={styles.input} multiline maxLength={2000} value={text} onChangeText={setText} placeholder="…" placeholderTextColor={colors.textMuted} />
      {detectPersonalData(text).length ? <Text style={[styles.note, styles.warn]}>{t("personalDataWarning")}</Text> : null}
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
  return outcomeLines(r, t, (iso) => formatInZone(iso, lang, undefined, "time") ?? iso).join("\n");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, paddingHorizontal: 0, color: colors.text },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: colors.text },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowText: { fontSize: 16, color: colors.text },
  meta: { color: colors.textMuted, marginTop: 2 },
  mapBox: { height: 220, borderRadius: 12, overflow: "hidden", marginBottom: 12 },
  map: { flex: 1 },
  nearby: { marginBottom: 12 },
  nearbyRow: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 8 },
  nearbySelected: { borderColor: colors.text, backgroundColor: colors.surfaceAlt },
  input: { minHeight: 100, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, textAlignVertical: "top", marginBottom: 12 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  note: { color: colors.textMuted, marginBottom: 12 },
  warn: { color: colors.like },
  callFirst: { backgroundColor: colors.accentSoft, padding: 12, borderRadius: 8, marginBottom: 12 },
  callFirstText: { color: "#FF8A8A", fontWeight: "600" },
  callButton: { backgroundColor: colors.accent, padding: 12, borderRadius: 8, marginTop: 10, alignItems: "center" },
  callButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  callLink: { color: colors.text, textDecorationLine: "underline", marginTop: 10 },
  send: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  disabled: { opacity: 0.5 },
  sendText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  status: { marginTop: 16, fontSize: 15, paddingHorizontal: 16, color: colors.text },
});
