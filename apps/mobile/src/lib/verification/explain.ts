import type { TimelineEntryType, VerificationView } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Por qué un evento tiene su estado (Blueprint §10.4): una línea por regla que aportó, en lenguaje llano, y el
 * recuento de evidencias separado por origen (ciudadana, externa, oficial). Nunca revela quién reportó.
 */
const CODE_KEY: Record<string, MessageKey> = {
  CITIZEN_CORROBORATION: "why_CITIZEN_CORROBORATION",
  CITIZEN_DENIALS: "why_CITIZEN_DENIALS",
  EXTERNAL_SOURCES: "why_EXTERNAL_SOURCES",
  OFFICIAL_CONFIRMATION: "why_OFFICIAL_CONFIRMATION",
  OFFICIAL_DENIAL: "why_OFFICIAL_DENIAL",
  EXTERNAL_DENIAL: "why_EXTERNAL_DENIAL",
  MARKED_FALSE: "why_MARKED_FALSE",
  DISPUTED: "why_DISPUTED",
  NOT_OFFICIAL_YET: "why_NOT_OFFICIAL_YET",
};

/**
 * Variantes con detalle (ADR 0086): horas de la ventana ciudadana, y nombre y hora de las fuentes. Una explicación
 * guardada antes no trae esos datos y usa la línea corta.
 */
const DETAILED: Record<string, { key: MessageKey; needs: string[] }> = {
  CITIZEN_CORROBORATION: { key: "why_CITIZEN_WINDOW", needs: ["from", "to"] },
  EXTERNAL_SOURCES: { key: "why_EXTERNAL_NAMED", needs: ["sources", "at"] },
  OFFICIAL_CONFIRMATION: { key: "why_OFFICIAL_NAMED", needs: ["sources", "at"] },
  OFFICIAL_DENIAL: { key: "why_OFFICIAL_DENIAL_NAMED", needs: ["sources", "at"] },
  EXTERNAL_DENIAL: { key: "why_EXTERNAL_DENIAL_NAMED", needs: ["sources", "at"] },
};
const TIME_PARAMS = new Set(["from", "to", "at"]);

/** Pesos con decimales (una persona nueva cuenta 0,5): se muestran con un decimal como mucho. */
const num = (v: unknown): string => (typeof v === "number" ? String(Math.round(v * 10) / 10) : String(v ?? ""));

export function fill(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => num(params[k]));
}

/**
 * Una línea por regla, en el orden del Blueprint §10.4: comunidad, fuentes externas, oficiales y lo que falta.
 * `time` da formato a las horas (en la zona del evento); sin él se muestran tal cual.
 */
export function explainLines(
  view: Pick<VerificationView, "explanation">, t: (k: MessageKey) => string, time: (iso: string) => string = (s) => s,
): string[] {
  return view.explanation.flatMap((e) => {
    const detailed = DETAILED[e.code];
    const key = detailed && detailed.needs.every((k) => e.params[k] !== undefined && e.params[k] !== "") ? detailed.key : CODE_KEY[e.code];
    if (!key) return [];
    // Sin confirmaciones todavía, la línea de corroboración no aporta nada.
    if (e.code === "CITIZEN_CORROBORATION" && !Number(e.params["independentWeight"])) return [];
    const params = Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, TIME_PARAMS.has(k) && typeof v === "string" ? time(v) : v]));
    return [fill(t(key), params)];
  });
}

export function evidenceLine(view: Pick<VerificationView, "evidenceSummary">, t: (k: MessageKey) => string): string {
  return fill(t("evidenceCounts"), view.evidenceSummary);
}

const TIMELINE_KEY: Partial<Record<TimelineEntryType, MessageKey>> = {
  CREATED: "tl_CREATED",
  REPORT_ADDED: "tl_REPORT_ADDED",
  COUNTER_REPORT_ADDED: "tl_COUNTER_REPORT_ADDED",
  SOURCE_ADDED: "tl_SOURCE_ADDED",
  OFFICIAL_UPDATE: "tl_OFFICIAL_UPDATE",
  VERIFICATION_CHANGED: "tl_VERIFICATION_CHANGED",
  NEGATIVE_STATE_CHANGED: "tl_NEGATIVE_STATE_CHANGED",
  STATUS_CHANGED: "tl_STATUS_CHANGED",
  MEDIA_ADDED: "tl_MEDIA_ADDED",
  MERGED: "tl_MERGED",
  SPLIT: "tl_SPLIT",
  REPORT_WITHDRAWN: "tl_REPORT_WITHDRAWN",
  REPORT_MODERATED: "tl_REPORT_MODERATED",
  REPORT_RESTORED: "tl_REPORT_RESTORED",
};

/** Texto de una entrada de la cronología; un tipo nuevo que la app aún no conoce se muestra tal cual. */
export function timelineLabel(type: TimelineEntryType | string, t: (k: MessageKey) => string): string {
  const key = TIMELINE_KEY[type as TimelineEntryType];
  return key ? t(key) : type;
}
