import { CountryLaunchConfig, compareDatasetVersions } from "@dizaster/contracts";

/**
 * Estado de lanzamiento por país (ADR 0317, ADR 0332, ADR 0334). Solo PILOT y AVAILABLE aceptan reportes ciudadanos;
 * un país sin entrada usa el valor de `defaults`, igual que el servidor. El dato viene de `launch` en `/v1/config`
 * (ADR 0341) cuando llega válido y no es más viejo que el del bundle; si no, de `data/countries/country-config.json`
 * (copiado al bundle por `scripts/sync-reference-data.mjs`): el código no conoce ningún país. El servidor sigue siendo
 * quien decide: esto solo evita que la persona prepare un reporte que el servidor va a rechazar. No se envía la
 * ubicación para esto: la app decide con su propia detección de país. NO AI REQUIRED.
 */
export type LaunchStatus = "PILOT" | "AVAILABLE" | "AVAILABLE_READ_ONLY" | "RESTRICTED";

export interface LaunchConfig {
  version?: string;
  defaults?: { launchStatus?: string; acceptsCitizenReports?: boolean };
  countries: readonly { iso2: string; launchStatus?: string; acceptsCitizenReports?: boolean }[];
}

const KNOWN: ReadonlySet<string> = new Set<LaunchStatus>(["PILOT", "AVAILABLE", "AVAILABLE_READ_ONLY", "RESTRICTED"]);
const ACCEPTS: ReadonlySet<LaunchStatus> = new Set<LaunchStatus>(["PILOT", "AVAILABLE"]);

const entryFor = (cfg: LaunchConfig, iso2: string | null) => (iso2 ? cfg.countries.find((c) => c.iso2 === iso2) : undefined);

/** Estado de un país (`null` = fuera de todo país: usa el valor por defecto, como el servidor). */
export function launchStatusIn(cfg: LaunchConfig, iso2: string | null): LaunchStatus {
  const raw = entryFor(cfg, iso2)?.launchStatus ?? cfg.defaults?.launchStatus;
  // Un valor desconocido nunca abre un país (el servidor ni siquiera arranca con él).
  return raw && KNOWN.has(raw) ? (raw as LaunchStatus) : "AVAILABLE_READ_ONLY";
}

export const acceptsCitizenReports = (status: LaunchStatus): boolean => ACCEPTS.has(status);

/**
 * Qué datos rigen: `launch` de `/v1/config` (de la red o la copia guardada en el teléfono) si es válido y su versión es
 * igual o más nueva que la del bundle. Si no viene, está mal formado o es más viejo (p. ej. una config guardada antes
 * de actualizar la app), el archivo empaquetado.
 */
export function effectiveLaunchConfig(bundled: LaunchConfig, remote: unknown): LaunchConfig {
  if (remote === undefined || remote === null) return bundled;
  const parsed = CountryLaunchConfig.safeParse(remote);
  if (!parsed.success) return bundled;
  if (bundled.version && compareDatasetVersions(parsed.data.version, bundled.version) < 0) return bundled;
  return parsed.data;
}

/** ¿Acepta reportes? Por el estado; si el dato trae `acceptsCitizenReports: false`, gana el cierre (nunca abre). */
export function reportsOpenWith(cfg: LaunchConfig, iso2: string | null): boolean {
  const own = entryFor(cfg, iso2);
  const flag = own ? own.acceptsCitizenReports : cfg.defaults?.acceptsCitizenReports;
  return acceptsCitizenReports(launchStatusIn(cfg, iso2)) && flag !== false;
}

/** Cuánto espera la pantalla de reporte a `/v1/config` (casi siempre ya está en memoria) antes de usar el bundle. */
export const LAUNCH_CONFIG_WAIT_MS = 3_000;

let bundled: LaunchConfig | null = null;

/**
 * ¿Se pueden enviar reportes ciudadanos desde este país? `remote` es `config.launch` tal como llegó (o `undefined`):
 * se valida aquí. Sin él, con los datos del bundle, sin red.
 */
export function reportsOpenIn(iso2: string | null, remote?: unknown): boolean {
  if (!bundled) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    bundled = require("../../reference-data/country-config.json") as LaunchConfig;
  }
  return reportsOpenWith(effectiveLaunchConfig(bundled, remote), iso2);
}
