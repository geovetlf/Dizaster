import type { AppConfig } from "@dizaster/contracts";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { api } from "../api";
import { configCache, type ConfigStore } from "./config-cache";

/** Una fila en la misma base local que la cola de reportes (ADR 0185). */
class SqliteConfigStore implements ConfigStore<AppConfig> {
  private db: Promise<SQLiteDatabase> | null = null;
  private open() {
    this.db ??= openDatabaseAsync("dizaster.db").then(async (db) => {
      await db.execAsync(`CREATE TABLE IF NOT EXISTS app_config (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, value TEXT NOT NULL)`);
      return db;
    });
    return this.db;
  }
  async load() {
    const row = await (await this.open()).getFirstAsync<{ value: string }>(`SELECT value FROM app_config WHERE id = 1`);
    return row ? (JSON.parse(row.value) as AppConfig) : null;
  }
  async save(value: AppConfig) {
    await (await this.open()).runAsync(`INSERT OR REPLACE INTO app_config (id, saved_at, value) VALUES (1, ?, ?)`, Date.now(), JSON.stringify(value));
  }
}

const shared = configCache(() => api.config(), new SqliteConfigStore());

/** Config remota: de la red si hay, si no la última guardada en el teléfono. Úsese en vez de `api.config()`. */
export const appConfig = (): Promise<AppConfig> => shared.get();
