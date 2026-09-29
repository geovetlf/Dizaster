import type { EmergencyDataset, EmergencyNumber } from "@dizaster/contracts";

export interface EmergencyLookup {
  country: string | null;
  numbers: EmergencyNumber[];
  /** true si ninguno de los números mostrados ha sido verificado contra la fuente oficial todavía. */
  unverified: boolean;
  /** Sin datos para el país: se muestra el estándar GSM 112 con advertencia. */
  fallbackToGsm112: boolean;
}

const SERVICE_ORDER = ["GENERAL", "POLICE", "FIRE", "AMBULANCE", "CIVIL_DEFENSE", "COAST_GUARD", "MOUNTAIN_RESCUE", "POISON", "GENDER_VIOLENCE", "CHILD", "OTHER"];

/** Busca los números del país detectado en el dataset empaquetado (funciona sin red). */
export function lookupEmergency(dataset: EmergencyDataset, country: string | null): EmergencyLookup {
  const numbers = country
    ? dataset.numbers
        .filter((n) => n.country === country)
        .sort((a, b) => SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service))
    : [];
  return {
    country,
    numbers,
    unverified: numbers.length > 0 && numbers.every((n) => n.verification !== "VERIFIED"),
    fallbackToGsm112: numbers.length === 0,
  };
}

export function label(n: EmergencyNumber, locale: string): string {
  const lang = locale.split("-")[0] ?? "es";
  return n.label[locale] ?? n.label[lang] ?? n.label["es"] ?? n.label["en"] ?? n.service;
}
