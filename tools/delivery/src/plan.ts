import type { Impact } from "./inspect.js";

export interface Gate { id: string; stage: number; command: string; why: string }

/**
 * Qué correr y en qué orden (Task Planner + Test Orchestrator, Blueprint §20.9). Lo barato primero; el orquestador se
 * detiene en el primer gate rojo. Los gates de una misma etapa pueden correr en paralelo. Las herramientas son las del
 * repositorio (pnpm, eslint, tsc, vitest): el Delivery Plane no las reemplaza.
 */
export function planGates(impact: Impact): Gate[] {
  const gates: Gate[] = [];
  const add = (stage: number, id: string, command: string, why: string) => gates.push({ id, stage, command, why });
  const full = impact.fullRegression;

  add(1, "secrets", "pnpm check:secrets", "siempre: ningún secreto entra al repositorio");
  add(1, "workflows", "pnpm check:workflows", "siempre: workflows con permisos mínimos y acciones fijadas");
  add(1, "policy", "pnpm dzd policy", "siempre: la clase de riesgo decide qué sigue");
  if (impact.areas.docsOnly) return gates;

  add(1, "lint", "pnpm lint", "estático y barato");
  add(1, "boundaries", "pnpm check:boundaries", "fronteras de módulos y del Delivery Plane");
  add(2, "typecheck", "pnpm typecheck", "tipos de todo el monorepo (barato y atrapa contratos rotos)");
  add(2, "build", "pnpm build", "paquetes compilables");
  if (full) add(3, "test", "pnpm test", "regresión completa: rama principal, versión, cambio crítico, contratos o migraciones");
  else for (const p of impact.affectedPackages) add(3, `test:${p}`, `pnpm --filter ${p} test`, "paquete cambiado o dependiente de uno cambiado");
  if (full || impact.areas.migrations) add(4, "restore", "pnpm db:restore-check", "el respaldo se restaura con el esquema nuevo");
  if (full || impact.areas.mobile || impact.areas.contracts) {
    add(4, "mobile-bundle", "pnpm --filter @dizaster/mobile run bundle:check", "la app empaqueta en iOS y Android");
    add(4, "mobile-native", "pnpm --filter @dizaster/mobile run native:check", "paridad nativa iOS/Android");
  }
  if (full || impact.areas.dependencies) {
    add(5, "supply-chain", "pnpm supply-chain", "licencias y avisos de seguridad de dependencias");
    add(5, "sbom", "pnpm sbom", "SBOM del artefacto");
  }
  return gates;
}
