import { z } from "zod";
import { CategoryCode, CountryCode } from "./common.js";

/**
 * Capa de donaciones (Blueprint §5.17, C-10, D-15; ADR 0274). V1: solo enlaces externos a organizaciones verificadas.
 * Dizaster no recibe, procesa ni guarda dinero ni datos de pago. Lógica pura, compartida. NO AI REQUIRED.
 */
export const DONATIONS_HANDLE_MONEY = false;

/** Una organización del directorio. Sin verificación registrada no entra (el esquema la rechaza). */
export const DonationOrganization = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/),
  name: z.string().min(2).max(120),
  /** Países donde se muestra (ISO 3166-1 alfa-2). */
  countries: z.array(CountryCode).min(1),
  /** Categorías de evento a las que ayuda; vacío = todas. Un padre cubre a sus hijas (`flood` cubre `flood.flash`). */
  categories: z.array(CategoryCode).default([]),
  /** Página de donación de la propia organización; solo https. Se abre fuera de la app. */
  url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "solo https"),
  /** Quién la verificó, cuándo y con qué evidencia (registro oficial, convenio). Obligatorio. */
  verification: z.object({ by: z.string().min(2).max(120), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), evidence: z.string().min(3).max(500) }),
  active: z.boolean().default(true),
});
export type DonationOrganization = z.infer<typeof DonationOrganization>;

export const DonationDirectory = z.object({ version: z.string().min(1), organizations: z.array(DonationOrganization) })
  .refine((d) => new Set(d.organizations.map((o) => o.id)).size === d.organizations.length, "ids de organización repetidos");
export type DonationDirectory = z.infer<typeof DonationDirectory>;

export const DonationLink = z.object({ id: z.string(), name: z.string(), url: z.string() });
export type DonationLink = z.infer<typeof DonationLink>;
export const EventDonationsResponse = z.object({ organizations: z.array(DonationLink) });
export type EventDonationsResponse = z.infer<typeof EventDonationsResponse>;

/** Como mucho estos enlaces por evento: una lista corta, sin ranking pagado. */
export const MAX_DONATION_LINKS = 3;

/**
 * Enlaces para un evento: organizaciones activas del país del evento que ayudan en su categoría (o en todas). Orden
 * estable por nombre: ninguna organización paga por aparecer primero. Sin país conocido, ninguna.
 */
export function donationLinksFor(dir: DonationDirectory, event: { countryCode: string | null; categoryCode: string }): DonationLink[] {
  if (!event.countryCode) return [];
  const covers = (c: string) => event.categoryCode === c || event.categoryCode.startsWith(`${c}.`);
  return dir.organizations
    .filter((o) => o.active && o.countries.includes(event.countryCode!) && (o.categories.length === 0 || o.categories.some(covers)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_DONATION_LINKS)
    .map(({ id, name, url }) => ({ id, name, url }));
}
