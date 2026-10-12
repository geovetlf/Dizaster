import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guestWriteRejected, isGuest, shouldPromptSignIn, SIGN_IN_PROMPT_COOLDOWN_MS } from "../src/lib/auth/guest";
import { acceptsCitizenReports, launchStatusIn } from "../src/lib/geo/launch-status";
import { serverErrorMessage, suspendedUntil } from "../src/lib/errors/server-error";
import { CATALOGS, type MessageKey } from "../src/lib/i18n";

// Restricciones de cuenta, país y suspensión en la app (ADR 0332). El servidor es la barrera real; la app no ofrece
// lo que el servidor va a rechazar y explica por qué. NO AI REQUIRED.
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("uso sin cuenta (ADR 0317, 0332)", () => {
  it("solo es invitado cuando la sesión ya arrancó y no hay con qué entrar", () => {
    expect(isGuest({ ready: true, needsSignIn: true })).toBe(true);
    expect(isGuest({ ready: false, needsSignIn: true })).toBe(false);
    expect(isGuest({ ready: true })).toBe(false);
    expect(isGuest({ ready: true, needsSignIn: false })).toBe(false);
  });

  it("una escritura rechazada sin sesión abre «Entrar»; una lectura o la autenticación no", () => {
    expect(guestWriteRejected(401, "POST", "/v1/posts", false)).toBe(true);
    expect(guestWriteRejected(401, "put", "/v1/follows/profile/x", false)).toBe(true);
    expect(guestWriteRejected(401, "GET", "/v1/me", false)).toBe(false);
    expect(guestWriteRejected(401, "POST", "/v1/auth/refresh", false)).toBe(false);
    // Con sesión, el 401 lo resuelve la renovación (y si falla, la sesión perdida).
    expect(guestWriteRejected(401, "POST", "/v1/posts", true)).toBe(false);
    expect(guestWriteRejected(403, "POST", "/v1/posts", false)).toBe(false);
  });

  it("«Entrar» se abre una sola vez aunque fallen varias escrituras a la vez", () => {
    expect(shouldPromptSignIn(null, 1_000)).toBe(true);
    expect(shouldPromptSignIn(1_000, 1_000 + SIGN_IN_PROMPT_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldPromptSignIn(1_000, 1_000 + SIGN_IN_PROMPT_COOLDOWN_MS)).toBe(true);
  });

  it("los formularios de escritura muestran «Necesitas una cuenta» sin cuenta", () => {
    for (const f of ["app/report.tsx", "app/compose.tsx", "app/flag.tsx", "app/alerts.tsx", "app/alert-settings.tsx"]) {
      expect(src(f), f).toMatch(/if \(guest\) return [^;]*<AccountRequired \/>/);
    }
    // Comentar lleva a «Entrar» y el perfil ofrece entrar en lugar de las opciones de la cuenta.
    expect(src("app/post/[id].tsx")).toContain('t("signInToComment")');
    expect(src("app/(tabs)/profile.tsx")).toMatch(/guest \? \(\s*<>\s*<Row icon="login" label=\{t\("signInAction"\)\}/);
  });
});

describe("estado de lanzamiento por país (ADR 0317, 0332)", () => {
  const cfg = { defaults: { launchStatus: "AVAILABLE_READ_ONLY" }, countries: [{ iso2: "PE", launchStatus: "PILOT" }, { iso2: "CL", launchStatus: "AVAILABLE" }, { iso2: "BO", launchStatus: "RESTRICTED" }, { iso2: "XX", launchStatus: "OPEN" }] };

  it("solo PILOT y AVAILABLE aceptan reportes; sin entrada o fuera de todo país, el valor por defecto", () => {
    expect(acceptsCitizenReports(launchStatusIn(cfg, "PE"))).toBe(true);
    expect(acceptsCitizenReports(launchStatusIn(cfg, "CL"))).toBe(true);
    expect(acceptsCitizenReports(launchStatusIn(cfg, "BO"))).toBe(false);
    expect(acceptsCitizenReports(launchStatusIn(cfg, "AR"))).toBe(false);
    expect(acceptsCitizenReports(launchStatusIn(cfg, null))).toBe(false);
  });

  it("un valor desconocido nunca abre un país", () => {
    expect(launchStatusIn(cfg, "XX")).toBe("AVAILABLE_READ_ONLY");
    expect(launchStatusIn({ countries: [] }, "PE")).toBe("AVAILABLE_READ_ONLY");
  });

  it("usa los mismos datos que el servidor (data/countries/country-config.json)", () => {
    const real = JSON.parse(readFileSync(new URL("../../../data/countries/country-config.json", import.meta.url), "utf8"));
    for (const c of real.countries as { iso2: string; launchStatus: string }[]) expect(launchStatusIn(real, c.iso2)).toBe(c.launchStatus);
    expect(launchStatusIn(real, null)).toBe(real.defaults.launchStatus);
    // El script de datos lo copia al bundle y la pantalla de reporte lo consulta antes de dejar escribir.
    expect(readFileSync(new URL("../scripts/sync-reference-data.mjs", import.meta.url), "utf8")).toContain("country-config.json");
    expect(src("app/report.tsx")).toMatch(/if \(!reportsOpenIn\(where\)\)/);
  });
});

describe("suspensión con fecha de fin (ADR 0319, 0332)", () => {
  const tr = (lang: keyof typeof CATALOGS) => (k: MessageKey) => CATALOGS[lang][k];
  const fmt = (iso: string) => iso.slice(0, 10);

  it("dice hasta cuándo en cada idioma si el servidor manda la fecha", () => {
    const body = { error: "ACCOUNT_SUSPENDED", message: "Tu cuenta está suspendida.", suspendedUntil: "2026-10-18T12:00:00.000Z" };
    for (const lang of ["es", "en", "pt", "fr"] as const) {
      const text = serverErrorMessage(body, 403, lang, tr(lang), fmt);
      expect(text, lang).toContain("2026-10-18");
      expect(text, lang).not.toContain("{date}");
    }
    expect(serverErrorMessage({ ...body, suspendedUntil: undefined, suspended_until: "2026-10-18T12:00:00Z" }, 403, "en", tr("en"), fmt)).toContain("2026-10-18");
  });

  it("sin fecha (permanente o servidor anterior) usa el texto de siempre", () => {
    expect(serverErrorMessage({ error: "ACCOUNT_SUSPENDED", message: "x" }, 403, "en", tr("en"), fmt)).toBe(CATALOGS.en.errAccountSuspended);
    expect(suspendedUntil({ suspendedUntil: null })).toBeNull();
    expect(suspendedUntil({ suspendedUntil: "mañana" })).toBeNull();
  });
});
