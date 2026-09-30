/**
 * Config remota persistida en el teléfono (ADR 0185). Sin red, las pantallas usan la última config conocida:
 * sobre todo el estilo del mapa, que es lo que hace funcionar las regiones descargadas. NO AI REQUIRED.
 * No es dato personal: no se borra al cerrar sesión ni caduca por edad (una config vieja es mejor que ninguna).
 */
export interface ConfigStore<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
}

/** Cuánto se reutiliza una config recién pedida antes de volver a la red (varias pantallas la piden a la vez). */
export const CONFIG_FRESH_MS = 5 * 60_000;

export function configCache<T>(fetcher: () => Promise<T>, store: ConfigStore<T>, now: () => number = Date.now) {
  let fresh: { value: T; at: number } | null = null;
  let inFlight: Promise<T> | null = null;

  async function fetchOrStored(): Promise<T> {
    try {
      const value = await fetcher();
      fresh = { value, at: now() };
      await store.save(value).catch(() => undefined);
      return value;
    } catch (err) {
      const stored = await store.load().catch(() => null);
      if (stored !== null) return stored;
      throw err;
    }
  }

  return {
    get(): Promise<T> {
      if (fresh && now() - fresh.at < CONFIG_FRESH_MS) return Promise.resolve(fresh.value);
      inFlight ??= fetchOrStored().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
