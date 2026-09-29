import { distanceMeters } from "@dizaster/geo-kit";
import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem } from "../index.js";
import type { FeedAdapter } from "./types.js";

/**
 * CAP 1.2 (OASIS Common Alerting Protocol), el formato estándar de alertas oficiales (ADR 0033). Acepta un
 * `<alert>` suelto, un Atom/RSS con alertas CAP incrustadas, o un Atom con el perfil de extensiones `cap:*`.
 *
 * El texto de `event` es propio de cada emisor ("Sismo", "Lluvias intensas"...), así que la categoría sale de la
 * configuración de la fuente (`eventMap`, por palabra clave, sin tildes ni mayúsculas); lo que no encaja se
 * ignora: no se inventa categoría. Solo mensajes reales (`status=Actual`); pruebas y ejercicios se descartan.
 */
interface CapConfig {
  eventMap?: Array<{ match: string; category: string }>;
  /** Idiomas preferidos para el título, en orden (p. ej. ["es", "en"]). */
  languages?: string[];
  /** Severidad CAP mínima para el carril URGENT (por defecto Severe). */
  urgentMinSeverity?: CapSeverity;
}

type CapSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
const SEVERITY: Record<CapSeverity, number> = { Extreme: 5, Severe: 4, Moderate: 3, Minor: 2, Unknown: 2 };
const URGENT_URGENCY = new Set(["Immediate", "Expected"]);
/** Sin polígono ni círculo no hay punto: un geocódigo solo (p. ej. un ubigeo) no se convierte aquí. */
const MIN_UNCERTAINTY_M = 1_000;

type Node = Record<string, unknown>;
const list = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return text((v as Node)["#text"]);
  const s = String(v).trim();
  return s === "" ? null : s;
};
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export const capAdapter: FeedAdapter = {
  adapterType: "cap-1.2",

  parse(body, rawConfig) {
    const config = rawConfig as CapConfig;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, trimValues: true });
    const doc = parser.parse(body) as Node;
    const items: NormalizedItem[] = [];
    for (const alert of findAlerts(doc)) {
      const item = normalizeAlert(alert, config);
      if (item) items.push(item);
    }
    return items;
  },

  isUrgent(item, rawConfig) {
    const min = SEVERITY[(rawConfig as CapConfig).urgentMinSeverity ?? "Severe"];
    return (item.severity ?? 0) >= min && URGENT_URGENCY.has(String(item.raw["urgency"] ?? ""));
  },
};

/** Alertas en cualquiera de las formas admitidas. En el perfil Atom `cap:*`, cada entrada es una alerta plana. */
function findAlerts(doc: Node): Node[] {
  if (doc["alert"]) return list(doc["alert"] as Node | Node[]);
  const entries = [
    ...list((doc["feed"] as Node | undefined)?.["entry"] as Node | Node[]),
    ...list(((doc["rss"] as Node | undefined)?.["channel"] as Node | undefined)?.["item"] as Node | Node[]),
  ];
  const out: Node[] = [];
  for (const e of entries) {
    const embedded = (e["content"] as Node | undefined)?.["alert"] ?? e["alert"];
    if (embedded) out.push(...list(embedded as Node | Node[]));
    else if (e["event"] && (e["polygon"] || e["circle"])) out.push(flatEntryAsAlert(e));
  }
  return out;
}

function flatEntryAsAlert(e: Node): Node {
  return {
    identifier: text(e["id"]), sent: text(e["sent"]) ?? text(e["updated"]) ?? text(e["published"]),
    status: e["status"] ?? "Actual", msgType: e["msgType"] ?? "Alert", references: e["references"],
    info: {
      event: e["event"], severity: e["severity"], urgency: e["urgency"], certainty: e["certainty"],
      effective: e["effective"], onset: e["onset"], expires: e["expires"], headline: e["title"], language: e["language"],
      area: { polygon: e["polygon"], circle: e["circle"], areaDesc: e["areaDesc"] },
    },
  };
}

function normalizeAlert(alert: Node, config: CapConfig): NormalizedItem | null {
  if (text(alert["status"]) !== "Actual") return null;
  const msgType = text(alert["msgType"]) ?? "Alert";
  // Una cancelación retira la alerta, no desmiente el suceso: no se registra como evidencia.
  if (msgType === "Cancel" || msgType === "Ack" || msgType === "Error") return null;
  const identifier = text(alert["identifier"]);
  const sent = parseDate(alert["sent"]);
  if (!identifier || !sent) return null;
  // Una actualización sigue siendo la misma alerta: se identifica por el mensaje original.
  const original = msgType === "Update" ? firstReference(text(alert["references"])) : null;

  const infos = list(alert["info"] as Node | Node[]);
  const info = pickInfo(infos, config.languages ?? ["es", "en"]);
  if (!info) return null;
  const event = text(info["event"]);
  const category = event ? categoryFor(event, config) : null;
  if (!category) return null;
  const geo = areaGeometry(list(info["area"] as Node | Node[]));

  const severity = (text(info["severity"]) ?? "Unknown") as CapSeverity;
  const title: Record<string, string> = {};
  for (const i of infos) {
    const lang = (text(i["language"]) ?? "en").slice(0, 2).toLowerCase();
    const h = text(i["headline"]) ?? text(i["event"]);
    if (h && !title[lang]) title[lang] = h.slice(0, 200);
  }
  const occurred = parseDate(info["onset"]) ?? parseDate(info["effective"]) ?? sent;
  return {
    externalId: original ?? identifier,
    categoryCode: category,
    point: geo?.point ?? null,
    uncertaintyM: geo?.radiusM ?? 0,
    occurredAt: occurred.toISOString(),
    publishedAt: sent.toISOString(),
    title: Object.keys(title).length > 0 ? title : null,
    link: text(info["web"]) ?? null,
    severity: SEVERITY[severity] ?? 2,
    assertion: "OCCURRING",
    raw: {
      identifier, msgType, event, urgency: text(info["urgency"]), certainty: text(info["certainty"]), capSeverity: severity,
      expires: parseDate(info["expires"])?.toISOString() ?? null,
      areaDesc: list(info["area"] as Node | Node[]).map((a) => text(a["areaDesc"])).filter(Boolean).join("; ") || null,
    },
  };
}

function pickInfo(infos: Node[], languages: string[]): Node | null {
  for (const lang of languages) {
    const hit = infos.find((i) => (text(i["language"]) ?? "en-US").toLowerCase().startsWith(lang.toLowerCase()));
    if (hit) return hit;
  }
  return infos[0] ?? null;
}

function categoryFor(event: string, config: CapConfig): string | null {
  const e = fold(event);
  return config.eventMap?.find((m) => e.includes(fold(m.match)))?.category ?? null;
}

function firstReference(refs: string | null): string | null {
  // "emisor,identificador,fecha emisor2,identificador2,fecha2": se usa el primer mensaje de la cadena.
  const first = refs?.split(/\s+/)[0]?.split(",");
  return first && first.length >= 2 && first[1] ? first[1] : null;
}

/**
 * Punto y radio de las áreas: centro de todos los vértices y círculos, y radio hasta el más lejano. Es una
 * aproximación a propósito (la zona exacta sigue en la fuente); el mapa muestra la alerta, no su contorno.
 */
function areaGeometry(areas: Node[]): { point: { lat: number; lng: number }; radiusM: number } | null {
  const pts: Array<{ lat: number; lng: number; r: number }> = [];
  for (const a of areas) {
    for (const poly of list(a["polygon"] as unknown)) {
      const s = text(poly);
      if (!s) continue;
      const pairs = s.split(/\s+/);
      // El polígono CAP repite el primer vértice al final: no debe pesar doble en el centro.
      if (pairs.length > 1 && pairs[0] === pairs[pairs.length - 1]) pairs.pop();
      for (const pair of pairs) {
        const [lat, lng] = pair.split(",").map(Number);
        if (valid(lat, lng)) pts.push({ lat: lat!, lng: lng!, r: 0 });
      }
    }
    for (const c of list(a["circle"] as unknown)) {
      const m = text(c)?.match(/^(-?[\d.]+),(-?[\d.]+)\s+([\d.]+)$/);
      if (m && valid(Number(m[1]), Number(m[2]))) pts.push({ lat: Number(m[1]), lng: Number(m[2]), r: Number(m[3]) * 1000 });
    }
  }
  if (pts.length === 0) return null;
  const point = { lat: round(avg(pts.map((p) => p.lat))), lng: round(avg(pts.map((p) => p.lng))) };
  const radius = Math.max(...pts.map((p) => distanceMeters(point, p) + p.r));
  return { point, radiusM: Math.max(MIN_UNCERTAINTY_M, Math.round(radius)) };
}

const valid = (lat: number | undefined, lng: number | undefined) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number) => Math.round(x * 1e5) / 1e5;

function parseDate(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
