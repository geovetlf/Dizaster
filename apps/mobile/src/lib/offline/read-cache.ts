import type { FeedTab } from "@dizaster/contracts";

/**
 * Lectura sin conexión (ADR 0066). Guarda en el teléfono la última respuesta buena de lo que más importa cuando cae la
 * red (avisos, mapa, eventos abiertos) y la muestra marcada como "guardada" si la petición falla. Sin servidor ni costo.
 */
export interface CacheEntry<T> { savedAt: number; value: T }

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, savedAt: number): Promise<void>;
  /** Borra lo más viejo que `maxAgeMs` y deja como mucho `maxEntries` (las más recientes). */
  prune(maxEntries: number, maxAgeMs: number, now: number): Promise<void>;
  clear(): Promise<void>;
}

/** Límites: poco espacio y nada eterno (los datos de un desastre caducan). */
export const READ_CACHE_LIMITS = { maxEntries: 60, maxAgeMs: 7 * 24 * 3600_000 } as const;

export type Cached<T> = { value: T; savedAt: number | null };

/**
 * Pide por red; si responde, guarda y devuelve (`savedAt: null` = fresco). Si falla, devuelve lo guardado con su hora.
 * Sin copia (o demasiado vieja): propaga el error original. Un fallo al guardar nunca rompe la pantalla.
 */
export async function readThrough<T>(store: CacheStore, key: string, fetcher: () => Promise<T>, now: () => number = Date.now): Promise<Cached<T>> {
  try {
    const value = await fetcher();
    await store.set(key, value, now()).catch(() => undefined);
    return { value, savedAt: null };
  } catch (err) {
    const hit = await store.get<T>(key).catch(() => null);
    if (hit && now() - hit.savedAt <= READ_CACHE_LIMITS.maxAgeMs) return { value: hit.value, savedAt: hit.savedAt };
    throw err;
  }
}

export class MemoryCacheStore implements CacheStore {
  private readonly m = new Map<string, CacheEntry<unknown>>();
  async get<T>(key: string) { return (this.m.get(key) as CacheEntry<T> | undefined) ?? null; }
  async set<T>(key: string, value: T, savedAt: number) { this.m.delete(key); this.m.set(key, { value, savedAt }); }
  async prune(maxEntries: number, maxAgeMs: number, now: number) {
    for (const [k, v] of this.m) if (now - v.savedAt > maxAgeMs) this.m.delete(k);
    const byAge = [...this.m.entries()].sort((a, b) => b[1].savedAt - a[1].savedAt);
    for (const [k] of byAge.slice(maxEntries)) this.m.delete(k);
  }
  async clear() { this.m.clear(); }
  get size() { return this.m.size; }
}

/** Claves: nunca llevan la ubicación del teléfono (el mapa guarda solo su última vista). */
export const cacheKeys = {
  alerts: "alerts:first-page",
  map: "map:last-view",
  event: (id: string) => `event:${id}`,
  /**
   * Primera página del feed de inicio (ADR 0294), por pestaña y categoría. "Cerca de mí" no se guarda: su respuesta
   * depende de dónde está el teléfono. La categoría es un código del catálogo, nunca texto libre.
   */
  feed: (tab: FeedTab, category: string | null): string | null =>
    tab === "nearby" ? null : `feed:${tab}:${category && /^[a-z0-9._-]{1,64}$/.test(category) ? category : "all"}`,
} as const;
