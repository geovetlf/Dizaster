import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { READ_CACHE_LIMITS, type CacheEntry, type CacheStore } from "./read-cache";

/** Copia local de lectura en SQLite (misma base que la cola de reportes, otra tabla). */
export class SqliteCacheStore implements CacheStore {
  private db: Promise<SQLiteDatabase>;

  constructor(name = "dizaster.db") {
    this.db = openDatabaseAsync(name).then(async (db) => {
      await db.execAsync(`CREATE TABLE IF NOT EXISTS read_cache (key TEXT PRIMARY KEY NOT NULL, saved_at INTEGER NOT NULL, value TEXT NOT NULL)`);
      return db;
    });
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const row = await (await this.db).getFirstAsync<{ saved_at: number; value: string }>(`SELECT saved_at, value FROM read_cache WHERE key = ?`, key);
    return row ? { savedAt: row.saved_at, value: JSON.parse(row.value) as T } : null;
  }

  async set<T>(key: string, value: T, savedAt: number): Promise<void> {
    await (await this.db).runAsync(`INSERT OR REPLACE INTO read_cache (key, saved_at, value) VALUES (?, ?, ?)`, key, savedAt, JSON.stringify(value));
  }

  async prune(maxEntries: number, maxAgeMs: number, now: number): Promise<void> {
    const db = await this.db;
    await db.runAsync(`DELETE FROM read_cache WHERE saved_at < ?`, now - maxAgeMs);
    await db.runAsync(`DELETE FROM read_cache WHERE key NOT IN (SELECT key FROM read_cache ORDER BY saved_at DESC LIMIT ?)`, maxEntries);
  }

  async clear(): Promise<void> {
    await (await this.db).runAsync(`DELETE FROM read_cache`);
  }
}

let shared: SqliteCacheStore | null = null;
/** Instancia única; poda al abrirse la primera vez. */
export function readCache(): SqliteCacheStore {
  if (!shared) {
    shared = new SqliteCacheStore();
    void shared.prune(READ_CACHE_LIMITS.maxEntries, READ_CACHE_LIMITS.maxAgeMs, Date.now()).catch(() => undefined);
  }
  return shared;
}
