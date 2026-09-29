import pg from "pg";

/** Cualquier cosa que pueda ejecutar SQL: el pool o una transacción en curso. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export async function withTransaction<T>(db: Db, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Punto PostGIS (geography) a partir de lat/lng, para parámetros SQL: ST_SetSRID(ST_MakePoint(lng, lat), 4326). */
export const POINT_SQL = (lngParam: number, latParam: number) =>
  `ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326)::geography`;
