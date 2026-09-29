import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CategoryCatalog,
  DEFAULT_MIN_AGE,
  EmergencyDataset,
  type CategoryConfig,
  type EmergencyNumber,
} from "@dizaster/contracts";

/**
 * Datos de referencia versionados (categorías, números de emergencia, países, fuentes).
 * Viven como archivos en /data: se revisan como código, se empaquetan en la app y no cuestan consultas.
 * Todo lo específico de un país (p. ej. Perú) es un dato aquí, nunca una rama en el código.
 */
export interface CountryConfigEntry {
  iso2: string;
  launchStatus: "PILOT" | "AVAILABLE" | "AVAILABLE_READ_ONLY" | "RESTRICTED";
  defaultLocale: string;
  languages: string[];
  timezones: string[];
  units: "metric" | "imperial";
  callingCode: string;
  /** Qué nivel del índice administrativo abierto es "ciudad" y cuál "distrito" en este país (sin él: ciudad por cercanía). */
  /** Edad mínima si el país exige más que la global (D-13). */
  minAge?: number;
  geo?: { cityLevel?: 1 | 2 | 3; districtLevel?: 1 | 2 | 3; levelNames?: Partial<Record<"1" | "2" | "3", string>> };
}

export class ReferenceData {
  readonly categories: CategoryCatalog;
  readonly emergency: EmergencyDataset;
  private readonly byCode: Map<string, CategoryConfig>;
  private readonly countries: Map<string, CountryConfigEntry>;
  readonly countriesVersion: string;
  private readonly defaultMinAge: number;
  readonly sources: Array<Record<string, unknown>>;

  constructor(readonly dataDir: string) {
    const read = (p: string) => JSON.parse(readFileSync(join(dataDir, p), "utf8")) as unknown;
    this.categories = CategoryCatalog.parse(read("categories/categories.json"));
    this.emergency = EmergencyDataset.parse(read("emergency-numbers/emergency-numbers.json"));
    this.byCode = new Map(this.categories.categories.map((c) => [c.code, c]));
    const countryFile = read("countries/country-config.json") as { version: string; defaults?: { minAge?: number }; countries: CountryConfigEntry[] };
    this.defaultMinAge = Math.max(DEFAULT_MIN_AGE, countryFile.defaults?.minAge ?? 0);
    this.countriesVersion = countryFile.version;
    this.countries = new Map(countryFile.countries.map((c) => [c.iso2, c]));
    this.sources = (read("source-registry/sources.json") as { sources: Array<Record<string, unknown>> }).sources;
    this.validate();
  }

  private validate() {
    for (const c of this.categories.categories) {
      if (c.parent && !this.byCode.has(c.parent)) throw new Error(`Categoría ${c.code}: padre ${c.parent} inexistente`);
      for (const x of c.compatibleWith) if (!this.byCode.has(x)) throw new Error(`Categoría ${c.code}: compatible ${x} inexistente`);
      if (c.publishDelayMinutes > 0 && c.sensitivity !== "HIGHLY_SENSITIVE") throw new Error(`Categoría ${c.code}: el retraso de publicación es solo para HIGHLY_SENSITIVE`);
    }
    for (const o of this.categories.regionOverrides) {
      if ((o.overrides.publishDelayMinutes ?? 0) > 0 && this.byCode.get(o.category)?.sensitivity !== "HIGHLY_SENSITIVE") {
        throw new Error(`Override ${o.category}/${o.country}: el retraso de publicación es solo para HIGHLY_SENSITIVE`);
      }
    }
  }

  /** Configuración efectiva de una categoría para un país (aplica overrides regionales). */
  category(code: string, country?: string | null): CategoryConfig | undefined {
    const base = this.byCode.get(code);
    if (!base || !country) return base;
    const o = this.categories.regionOverrides.find((r) => r.category === code && r.country === country);
    if (!o) return base;
    if (!o.enabled) return undefined;
    return { ...base, ...o.overrides, names: { ...base.names, ...(o.names ?? {}) } };
  }

  isLeaf(code: string): boolean {
    return !this.categories.categories.some((c) => c.parent === code);
  }

  emergencyNumbers(country: string): EmergencyNumber[] {
    return this.emergency.numbers.filter((n) => n.country === country);
  }

  /** Edad mínima que se aplica: la global o la del país, la que sea mayor. */
  minAge(country?: string | null): number {
    const c = country ? this.countries.get(country)?.minAge : undefined;
    return Math.max(this.defaultMinAge, c ?? 0);
  }

  country(iso2: string): CountryConfigEntry | undefined {
    return this.countries.get(iso2);
  }
}
