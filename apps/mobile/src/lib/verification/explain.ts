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
};

/** Pesos con decimales (una persona nueva cuenta 0,5): se muestran con un decimal como mucho. */
const num = (v: unknown): string => (typeof v === "number" ? String(Math.round(v * 10) / 10) : String(v ?? ""));

export function fill(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => num(params[k]));
}

export function explainLines(view: Pick<VerificationView, "explanation">, t: (k: MessageKey) => string): string[] {
  return view.explanation.flatMap((e) => {
    const key = CODE_KEY[e.code];
    if (!key) return [];
    // Sin confirmaciones todavía, la línea de corroboración no aporta nada.
    if (e.code === "CITIZEN_CORROBORATION" && !Number(e.params["independentWeight"])) return [];
    return [fill(t(key), e.params)];
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
};

/** Texto de una entrada de la cronología; un tipo nuevo que la app aún no conoce se muestra tal cual. */
export function timelineLabel(type: TimelineEntryType | string, t: (k: MessageKey) => string): string {
  const key = TIMELINE_KEY[type as TimelineEntryType];
  return key ? t(key) : type;
}
