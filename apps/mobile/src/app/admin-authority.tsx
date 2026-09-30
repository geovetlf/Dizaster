import {
  AUTHORITY_REQUEST_CHANNELS,
  AUTHORITY_REQUEST_TRANSITIONS,
  AUTHORITY_REQUEST_TYPES,
  type AuthorityRequestChannel,
  type AuthorityRequestDetail,
  type AuthorityRequestStatus,
  type AuthorityRequestSummary,
  type AuthorityRequestType,
} from "@dizaster/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { dueFromDays, parseSubjectRefs, shortId } from "../lib/admin/admin-tools";
import { api } from "../lib/api";
import { t, type MessageKey } from "../lib/i18n";
import { colors, radius, space } from "../theme";

const typeLabel = (x: AuthorityRequestType) => t(`authType_${x}` as MessageKey);
const channelLabel = (x: AuthorityRequestChannel) => t(`authChannel_${x}` as MessageKey);
const statusLabel = (x: AuthorityRequestStatus) => t(`authStatus_${x}` as MessageKey);

/**
 * Registro auditado de requerimientos de autoridades (ADR 0139). Solo administración y SOLO registro: esta pantalla no
 * entrega ni exporta datos de nadie (decisión del propietario, hasta contar con asesoría legal).
 */
export default function AdminAuthorityScreen() {
  const [list, setList] = useState<AuthorityRequestSummary[]>([]);
  const [open, setOpen] = useState<AuthorityRequestDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ authority: "", country: "", reference: "", summary: "", dueDays: "", subjects: "" });
  const [type, setType] = useState<AuthorityRequestType>("DATA_DISCLOSURE");
  const [channel, setChannel] = useState<AuthorityRequestChannel>("EMAIL");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.authorityRequests().then((r) => setList(r.requests)).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(reload);

  function create() {
    const now = new Date();
    const due = dueFromDays(form.dueDays, now);
    const refs = parseSubjectRefs(form.subjects);
    const country = form.country.trim().toUpperCase();
    if (form.authority.trim().length < 2 || !/^[A-Z]{2}$/.test(country) || !form.summary.trim() || due === "invalid" || refs.invalid.length > 0) {
      setError(t("authorityInvalid"));
      return;
    }
    api.createAuthorityRequest({
      authority: form.authority.trim(), country, type, channel, summary: form.summary.trim(), receivedAt: now.toISOString(),
      subjectRefs: refs.values, ...(due ? { dueAt: due } : {}), ...(form.reference.trim() ? { externalReference: form.reference.trim() } : {}),
    })
      .then((d) => { setOpen(d); setCreating(false); setForm({ authority: "", country: "", reference: "", summary: "", dueDays: "", subjects: "" }); setError(null); reload(); })
      .catch((e: Error) => setError(e.message));
  }

  function toggle(id: string) {
    if (open?.id === id) { setOpen(null); return; }
    setNote("");
    api.authorityRequest(id).then(setOpen).catch((e: Error) => setError(e.message));
  }

  function step(next: AuthorityRequestStatus | null) {
    if (!open) return;
    if (!note.trim()) { setError(t("authorityNote")); return; }
    const call = next ? api.changeAuthorityRequestStatus(open.id, next, note.trim()) : api.addAuthorityRequestNote(open.id, note.trim());
    call.then((d) => { setOpen(d); setNote(""); setError(null); reload(); }).catch((e: Error) => setError(e.message));
  }

  const field = (key: keyof typeof form, placeholder: string, multiline = false) => (
    <TextInput accessibilityLabel={placeholder}
      value={form[key]}
      onChangeText={(x) => setForm((f) => ({ ...f, [key]: x }))}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      multiline={multiline}
      autoCapitalize={key === "country" ? "characters" : key === "subjects" ? "none" : "sentences"}
      keyboardType={key === "dueDays" ? "number-pad" : "default"}
      style={[styles.input, multiline && styles.multiline]}
    />
  );

  return (
    <FlatList automaticallyAdjustKeyboardInsets
      style={styles.container}
      contentContainerStyle={styles.content}
      data={list}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.meta}>{t("authorityHint")}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {creating ? (
            <View style={styles.card}>
              {field("authority", t("authorityName"))}
              {field("country", t("authorityCountry"))}
              {field("reference", t("authorityReference"))}
              <Chips values={AUTHORITY_REQUEST_TYPES} selected={type} label={typeLabel} onPick={setType} />
              <Chips values={AUTHORITY_REQUEST_CHANNELS} selected={channel} label={channelLabel} onPick={setChannel} />
              {field("summary", t("authoritySummary"), true)}
              {field("dueDays", t("authorityDueDays"))}
              {field("subjects", t("authoritySubjects"))}
              <Pressable accessibilityRole="button" style={styles.primary} onPress={create}>
                <Text style={styles.primaryText}>{t("save")}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => setCreating(true)}>
              <Text style={styles.primaryText}>{t("authorityNew")}</Text>
            </Pressable>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={styles.meta}>{t("authorityEmpty")}</Text>}
      renderItem={({ item }) => {
        const d = open?.id === item.id ? open : null;
        return (
          <Pressable accessibilityRole="button" style={styles.card} onPress={() => toggle(item.id)}>
            <Text style={styles.title}>{item.authority} · {item.country}</Text>
            <Text style={item.overdue ? styles.error : styles.meta}>
              {typeLabel(item.type)} · {statusLabel(item.status)} · {item.receivedAt.slice(0, 10)}
              {item.dueAt ? ` → ${item.dueAt.slice(0, 10)}` : ""}{item.overdue ? ` · ${t("authorityOverdue")}` : ""}
            </Text>
            {d ? (
              <View style={styles.detail}>
                <Text style={styles.body}>{d.summary}</Text>
                {d.externalReference ? <Text style={styles.meta}>{d.externalReference} · {channelLabel(d.channel)}</Text> : null}
                {d.subjectRefs.length ? <Text style={styles.meta}>{d.subjectRefs.join(" ")}</Text> : null}
                {d.log.map((l, i) => (
                  <Text key={i} style={styles.meta}>
                    {l.at.slice(0, 16).replace("T", " ")} · {l.actorUserId ? shortId(l.actorUserId) : "—"} · {l.toStatus ? statusLabel(l.toStatus) : t("authorityAddNote")}
                    {l.note ? `: ${l.note}` : ""}
                  </Text>
                ))}
                <TextInput accessibilityLabel={t("authorityNote")} value={note} onChangeText={setNote} placeholder={t("authorityNote")} placeholderTextColor={colors.textMuted} multiline style={[styles.input, styles.multiline]} />
                <View style={styles.chips}>
                  <Pressable accessibilityRole="button" style={styles.chip} onPress={() => step(null)}>
                    <Text style={styles.chipText}>{t("authorityAddNote")}</Text>
                  </Pressable>
                  {AUTHORITY_REQUEST_TRANSITIONS[d.status].map((s) => (
                    <Pressable key={s} accessibilityRole="button" style={styles.chip} onPress={() => step(s)}>
                      <Text style={styles.chipText}>→ {statusLabel(s)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

function Chips<T extends string>(p: { values: readonly T[]; selected: T; label: (x: T) => string; onPick: (x: T) => void }) {
  return (
    <View style={styles.chips}>
      {p.values.map((v) => (
        <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: v === p.selected }}
          style={[styles.chip, v === p.selected && styles.chipOn]} onPress={() => p.onPick(v)}>
          <Text style={styles.chipText}>{p.label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  header: { gap: space.sm, marginBottom: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.xs },
  detail: { gap: space.xs, marginTop: space.sm },
  title: { color: colors.text, fontWeight: "700" },
  body: { color: colors.text },
  meta: { color: colors.textMuted },
  error: { color: colors.accentText },
  input: { color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  multiline: { minHeight: 64, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.xs },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.text },
  primary: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, alignItems: "center" },
  primaryText: { color: colors.white, fontWeight: "700" },
});
