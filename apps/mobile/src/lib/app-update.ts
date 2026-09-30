import { isBelowMinVersion, type AppConfig } from "@dizaster/contracts";

/**
 * ¿Esta versión puede enviar reportes y publicar? (ADR 0164). NO AI REQUIRED. Sin config, sin versión o sin mínimo,
 * sí: nunca se bloquea por falta de datos. Emergencias nunca pasa por aquí.
 */
export function updateRequirement(cfg: Pick<AppConfig, "appUpdate"> | null | undefined, platform: string, version: string | null): { required: boolean; storeUrl: string | null } {
  const p = platform === "android" ? cfg?.appUpdate?.android : platform === "ios" ? cfg?.appUpdate?.ios : undefined;
  return { required: isBelowMinVersion(version, p?.minVersion), storeUrl: p?.storeUrl ?? null };
}
