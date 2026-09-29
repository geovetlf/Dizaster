import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { QueueStorage, QueuedReport } from "./queue";

/** Persistencia de la cola offline en SQLite local (sobrevive a cierres de la app y reinicios). */
export class SqliteQueueStorage implements QueueStorage {
  private db: Promise<SQLiteDatabase>;

  constructor(name = "dizaster.db") {
    this.db = openDatabaseAsync(name).then(async (db) => {
      await db.execAsync(`CREATE TABLE IF NOT EXISTS report_queue (id TEXT PRIMARY KEY NOT NULL, item TEXT NOT NULL)`);
      return db;
    });
  }

  async put(item: QueuedReport): Promise<void> {
    const db = await this.db;
    await db.runAsync(`INSERT OR REPLACE INTO report_queue (id, item) VALUES (?, ?)`, item.clientReportId, JSON.stringify(item));
  }

  async all(): Promise<QueuedReport[]> {
    const db = await this.db;
    const rows = await db.getAllAsync<{ item: string }>(`SELECT item FROM report_queue`);
    return rows.map((r) => JSON.parse(r.item) as QueuedReport);
  }

  async remove(clientReportId: string): Promise<void> {
    const db = await this.db;
    await db.runAsync(`DELETE FROM report_queue WHERE id = ?`, clientReportId);
  }
}
