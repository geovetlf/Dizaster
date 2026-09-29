import type { NormalizedItem } from "../index.js";
import { num, type FeedAdapter } from "./types.js";

type Confidence = "low" | "nominal" | "high";
const RANK: Record<Confidence, number> = { low: 0, nominal: 1, high: 2 };

/** VIIRS da "l"/"n"/"h"; MODIS, un porcentaje. Se lleva todo a tres niveles. */
export function firmsConfidence(raw: string): Confidence | null {
  const v = raw.trim().toLowerCase();
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  if (v === "h" || v === "high") return "high";
  const pct = Number(v);
  if (!Number.isFinite(pct) || v === "") return null;
  return pct >= 80 ? "high" : pct >= 30 ? "nominal" : "low";
}

/** Potencia radiativa del foco (MW) → severidad. Un foco aislado nunca es 5: eso lo decide la evidencia. */
export function frpToSeverity(frp: number): number {
  if (frp >= 500) return 4;
  if (frp >= 100) return 3;
  return 2;
}

/** Parser CSV mínimo (FIRMS no usa comillas ni comas dentro de campos). */
function rows(body: string): Record<string, string>[] {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i] ?? `c${i}`, v.trim()])));
}

/**
 * NASA FIRMS — focos de calor VIIRS/MODIS en CSV (API "area"; datos abiertos, clave MAP_KEY gratuita).
 * Cada foco es un ítem; el Event Engine los agrupa por radio y ventana en un solo incendio. Sin ids en la fuente:
 * el id es satélite + fecha/hora de paso + coordenadas (estable entre descargas). Solo ingiere confianza ≥ `minConfidence`
 * (por defecto "nominal") y como mucho `maxItems` focos por descarga, los de mayor potencia primero.
 */
export const firmsAdapter: FeedAdapter = {
  adapterType: "firms-csv",

  parse(body, config) {
    const head = body.slice(0, 200).trim();
    if (!/^latitude\s*,/i.test(head)) throw new Error(`FIRMS: respuesta inesperada (${head.slice(0, 60).replace(/[^\w .:-]/g, "")})`);
    const min = firmsConfidence(String(config["minConfidence"] ?? "nominal")) ?? "nominal";
    const maxItems = num(config["maxItems"], 2000);
    const items: NormalizedItem[] = [];
    for (const r of rows(body)) {
      const lat = Number(r["latitude"]);
      const lng = Number(r["longitude"]);
      const date = r["acq_date"] ?? "";
      const time = (r["acq_time"] ?? "").padStart(4, "0");
      const conf = firmsConfidence(r["confidence"] ?? "");
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time) || !conf || RANK[conf] < RANK[min]) continue;
      const at = new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
      if (Number.isNaN(at.getTime())) continue;
      const frp = Number(r["frp"]);
      const scan = Number(r["scan"]);
      const track = Number(r["track"]);
      const satellite = r["satellite"] || r["instrument"] || "FIRMS";
      // Tamaño del píxel en el suelo (km): la incertidumbre del foco es del orden de medio píxel.
      const pixelM = Number.isFinite(scan) && Number.isFinite(track) ? Math.max(scan, track) * 1000 : 1000;
      items.push({
        externalId: `${satellite}-${date}-${time}-${lat.toFixed(4)}-${lng.toFixed(4)}`,
        categoryCode: "fire.wildfire",
        point: { lat, lng },
        uncertaintyM: Math.max(200, Math.round(pixelM / 2)),
        occurredAt: at.toISOString(),
        publishedAt: null,
        title: { es: "Foco de calor detectado por satélite", en: "Satellite-detected hotspot" },
        severity: frpToSeverity(Number.isFinite(frp) ? frp : 0),
        assertion: "OCCURRING",
        raw: { satellite, instrument: r["instrument"] ?? null, confidence: conf, frp: Number.isFinite(frp) ? frp : null, daynight: r["daynight"] ?? null },
      });
    }
    return items.sort((a, b) => Number(b.raw["frp"] ?? 0) - Number(a.raw["frp"] ?? 0)).slice(0, maxItems);
  },

  isUrgent(item, config) {
    return item.raw["confidence"] === "high" && Number(item.raw["frp"] ?? 0) >= num(config["urgentMinFrp"], 100);
  },
};
