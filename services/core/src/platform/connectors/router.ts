import { AI_CAPABILITY_INFO, canonicalCapability, type AiCapability } from "./capabilities.js";
import type { AIProvider } from "./types.js";

/**
 * AI ROUTER (ADR 0217): decide qué adaptadores de proveedor atienden cada capacidad y en qué orden.
 *
 *   DIZASTER → AI CORE (presupuesto, minimización, registro) → AI ROUTER (ruta por capacidad) → PROVIDER ADAPTER → MODELO
 *
 * - Sin rutas ni proveedor por defecto, la IA está apagada: el sistema completo funciona igual (reglas deterministas).
 * - Cada capacidad tiene su cadena ("CLASSIFY_INCIDENT=local,proveedor-a"); si el primero falla, se prueba el siguiente.
 * - Un proveedor nuevo es un adaptador más en el registro: ni el AI Core ni los módulos de negocio cambian.
 * - Solo proveedores directos (sin agregadores): cada adaptador habla con un único proveedor o modelo propio.
 */
export class AiRouter {
  private readonly chains: ReadonlyMap<AiCapability, readonly AIProvider[]>;

  constructor(providers: readonly AIProvider[], routes: Partial<Record<AiCapability, readonly string[]>> = {}, defaultChain: readonly string[] = []) {
    const byId = new Map(providers.map((p) => [p.id, p]));
    const resolve = (ids: readonly string[]) => ids.map((id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`AI_ROUTES: proveedor desconocido "${id}"`);
      return p;
    }).filter((p) => p.id !== "none");
    const chains = new Map<AiCapability, readonly AIProvider[]>();
    for (const c of Object.keys(AI_CAPABILITY_INFO) as AiCapability[]) chains.set(c, resolve(routes[c] ?? defaultChain));
    this.chains = chains;
  }

  /** Router con un solo proveedor para todas las capacidades (compatibilidad con AI_PROVIDER). */
  static single(provider: AIProvider): AiRouter {
    return new AiRouter([provider], {}, [provider.id]);
  }

  /** Proveedores configurados para la capacidad, en orden (vacío = apagada). */
  configured(capability: AiCapability): readonly AIProvider[] {
    return this.chains.get(capability) ?? [];
  }

  /** De los configurados, los que pueden atenderla: texto por defecto; imagen, video, etc. solo si lo declaran. */
  eligible(capability: AiCapability): AIProvider[] {
    return this.configured(capability).filter((p) => supports(p, capability));
  }

  get enabled(): boolean {
    return [...this.chains.values()].some((c) => c.length > 0);
  }

  /** Id de proveedor para mostrar: "none", el único o "a+b" si hay varios. Sin secretos. */
  get summary(): string {
    const ids = [...new Set([...this.chains.values()].flat().map((p) => p.id))];
    return ids.length === 0 ? "none" : ids.join("+");
  }

  /** Todos los proveedores que alguna ruta usa (para el control de costo cero). */
  get providers(): AIProvider[] {
    return [...new Set([...this.chains.values()].flat())];
  }
}

export function supports(p: AIProvider, capability: AiCapability): boolean {
  if (p.capabilities) return p.capabilities.includes(capability);
  return AI_CAPABILITY_INFO[capability].modality === "text";
}

/**
 * Lee AI_ROUTES: "CAPACIDAD=prov1,prov2;OTRA=prov3;*=prov4". `*` es la cadena por defecto. Acepta los nombres
 * anteriores de capacidades. Una capacidad desconocida es un error de configuración (falla al arrancar).
 */
export function parseAiRoutes(spec: string): { routes: Partial<Record<AiCapability, string[]>>; defaultChain: string[] | null } {
  const routes: Partial<Record<AiCapability, string[]>> = {};
  let defaultChain: string[] | null = null;
  for (const part of spec.split(";").map((x) => x.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new Error(`AI_ROUTES: falta "=" en "${part}"`);
    const key = part.slice(0, eq).trim();
    const ids = part.slice(eq + 1).split(",").map((x) => x.trim()).filter(Boolean);
    if (key === "*") { defaultChain = ids; continue; }
    const cap = canonicalCapability(key);
    if (!cap) throw new Error(`AI_ROUTES: capacidad desconocida "${key}"`);
    routes[cap] = ids;
  }
  return { routes, defaultChain };
}
