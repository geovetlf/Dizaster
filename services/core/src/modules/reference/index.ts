import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CategoryCatalog,
  DEFAULT_MIN_AGE,
  DonationDirectory,
  effectiveCategory,
  EmergencyDataset,
  ModerationTermList,
  LegalDocumentsFile,
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
  /** Moneda local (ISO 4217) para formatos regionales (Language Engine, ADR 0216). */
  currency?: string;
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
  /** Listas de términos que envían a revisión (ADR 0148). Empiezan vacías. */
  readonly moderationTerms: ModerationTermList;
  /** Términos y políticas con versión (ADR 0176). Sin versión aún: textos bloqueados a la espera de asesoría legal. */
  readonly legal: LegalDocumentsFile;
  /** Organizaciones verificadas para donar (D-15, ADR 0274). Vacío hasta que el propietario las cargue. */
  readonly donations: DonationDirectory;

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
    this.moderationTerms = ModerationTermList.parse(read("moderation/terms.json"));
    this.legal = LegalDocumentsFile.parse(read("legal/documents.json"));
    this.donations = DonationDirectory.parse(read("donations/organizations.json"));
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
    for (const o of this.donations.organizations) {
      for (const c of o.categories) if (!this.byCode.has(c)) throw new Error(`Donaciones ${o.id}: categoría ${c} inexistente`);
    }
    validateSourceCategoryMaps(this.sources, (code) => this.byCode.has(code) && this.isLeaf(code));
  }

  /** Configuración efectiva de una categoría para un país (aplica overrides regionales). */
  category(code: string, country?: string | null): CategoryConfig | undefined {
    return country ? effectiveCategory(this.categories, code, country) : this.byCode.get(code);
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

/**
 * Mapeos de categoría del registro de fuentes (§9.4, ADR 0122): `config.categoryMap` (tipo → categoría) y
 * `config.eventMap` de CAP. Cada destino debe ser una categoría hoja del catálogo y estar entre las declaradas por
 * la fuente: un error de datos no puede crear eventos en categorías inventadas o que la fuente no cubre.
 */
export function validateSourceCategoryMaps(sources: Array<Record<string, unknown>>, isLeafCategory: (code: string) => boolean): void {
  for (const s of sources) {
    const config = (s["config"] ?? {}) as Record<string, unknown>;
    const declared = new Set((s["categories"] as string[] | undefined) ?? []);
    const map = config["categoryMap"];
    const targets = [
      ...(map && typeof map === "object" ? Object.values(map as Record<string, unknown>) : []),
      ...(Array.isArray(config["eventMap"]) ? (config["eventMap"] as { category?: unknown }[]).map((m) => m.category) : []),
    ];
    for (const t of targets) {
      if (typeof t !== "string" || !isLeafCategory(t)) throw new Error(`Fuente ${String(s["key"])}: el mapeo apunta a una categoría inexistente: ${String(t)}`);
      if (!declared.has(t)) throw new Error(`Fuente ${String(s["key"])}: el mapeo apunta a ${t}, que la fuente no declara en "categories"`);
    }
  }
}
