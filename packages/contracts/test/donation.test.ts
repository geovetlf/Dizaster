import { describe, expect, it } from "vitest";
import { DONATIONS_HANDLE_MONEY, DonationDirectory, donationLinksFor, MAX_DONATION_LINKS } from "../src/donation.js";

// Donaciones V1 (D-15, ADR 0274): solo enlaces a organizaciones verificadas; Dizaster no toca dinero.
const org = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Org ${id}`, countries: ["PE"], url: `https://${id}.example.org/donar`,
  verification: { by: "propietario", at: "2026-09-30", evidence: "registro oficial" }, ...over,
});

describe("directorio de donaciones", () => {
  it("Dizaster no maneja dinero en V1", () => expect(DONATIONS_HANDLE_MONEY).toBe(false));

  it("rechaza organizaciones sin verificación, con http o con id repetido", () => {
    expect(DonationDirectory.safeParse({ version: "1", organizations: [org("uno", { verification: undefined })] }).success).toBe(false);
    expect(DonationDirectory.safeParse({ version: "1", organizations: [org("uno", { url: "http://uno.example.org" })] }).success).toBe(false);
    expect(DonationDirectory.safeParse({ version: "1", organizations: [org("uno"), org("uno")] }).success).toBe(false);
  });

  it("enlaza por país y categoría (un padre cubre a sus hijas), en orden estable y con tope", () => {
    const dir = DonationDirectory.parse({ version: "1", organizations: [
      org("zeta"), org("inundacion", { categories: ["flood"] }), org("incendio", { categories: ["fire"] }),
      org("chile", { countries: ["CL"] }), org("inactiva", { active: false }), org("alfa"), org("beta"),
    ] });
    const links = donationLinksFor(dir, { countryCode: "PE", categoryCode: "flood.flash" });
    expect(links.map((l) => l.id)).toEqual(["alfa", "beta", "inundacion"]);
    expect(links).toHaveLength(MAX_DONATION_LINKS);
    expect(Object.keys(links[0]!)).toEqual(["id", "name", "url"]);
    expect(donationLinksFor(dir, { countryCode: null, categoryCode: "flood" })).toEqual([]);
    expect(donationLinksFor(dir, { countryCode: "CL", categoryCode: "fire" }).map((l) => l.id)).toEqual(["chile"]);
  });
});
