/**
 * Estado de lanzamiento por país (ADR 0317, ADR 0332). Solo PILOT y AVAILABLE aceptan reportes ciudadanos; un país
 * sin entrada usa el valor de `defaults`, igual que el servidor. El dato viene de `data/countries/country-config.json`
 * (copiado al bundle por `scripts/sync-reference-data.mjs`): el código no conoce ningún país. El servidor sigue siendo
 * quien decide: esto solo evita que la persona prepare un reporte que el servidor va a rechazar. NO AI REQUIRED.
 */
export type LaunchStatus = "PILOT" | "AVAILABLE" | "AVAILABLE_READ_ONLY" | "RESTRICTED";

export interface LaunchConfig {
  defaults?: { launchStatus?: string };
  countries: readonly { iso2: string; launchStatus?: string }[];
}

const KNOWN: ReadonlySet<string> = new Set<LaunchStatus>(["PILOT", "AVAILABLE", "AVAILABLE_READ_ONLY", "RESTRICTED"]);
const ACCEPTS: ReadonlySet<LaunchStatus> = new Set<LaunchStatus>(["PILOT", "AVAILABLE"]);

/** Estado de un país (`null` = fuera de todo país: usa el valor por defecto, como el servidor). */
export function launchStatusIn(cfg: LaunchConfig, iso2: string | null): LaunchStatus {
  const own = iso2 ? cfg.countries.find((c) => c.iso2 === iso2)?.launchStatus : undefined;
  const raw = own ?? cfg.defaults?.launchStatus;
  // Un valor desconocido nunca abre un país (el servidor ni siquiera arranca con él).
  return raw && KNOWN.has(raw) ? (raw as LaunchStatus) : "AVAILABLE_READ_ONLY";
}

export const acceptsCitizenReports = (status: LaunchStatus): boolean => ACCEPTS.has(status);

let bundled: LaunchConfig | null = null;

/** ¿Se pueden enviar reportes ciudadanos desde este país? Con los datos del bundle, sin red. */
export function reportsOpenIn(iso2: string | null): boolean {
  if (!bundled) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    bundled = require("../../reference-data/country-config.json") as LaunchConfig;
  }
  return acceptsCitizenReports(launchStatusIn(bundled, iso2));
}
