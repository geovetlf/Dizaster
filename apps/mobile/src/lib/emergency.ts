import { compareDatasetVersions, type EmergencyDataset, type EmergencyNumber } from "@dizaster/contracts";

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

/** Se queda con el dataset más nuevo entre el empaquetado y el descargado (una app actualizada puede traer uno más reciente). */
export function newestDataset(bundled: EmergencyDataset, cached: EmergencyDataset | null): EmergencyDataset {
  return cached && compareDatasetVersions(cached.version, bundled.version) > 0 ? cached : bundled;
}

/**
 * País de reserva cuando no hay ubicación: la región de los ajustes del teléfono ("es-PE" → "PE").
 * Blueprint §11: ubicación → SIM/red → locale del sistema.
 */
export function regionOf(locale: string): string | null {
  const m = /[-_]([A-Za-z]{2})(?:[-_@]|$)/.exec(locale);
  return m ? m[1]!.toUpperCase() : null;
}
