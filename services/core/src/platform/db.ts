import pg from "pg";

/** Cualquier cosa que pueda ejecutar SQL: el pool o una transacción en curso. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export type Db = pg.Pool;

/**
 * Límites de la conexión (ADR 0201, §5.22): en un pico se falla rápido en vez de encolar sin fin. Los CLI (migrar,
 * importar geografía) no los usan: pueden tardar lo que haga falta.
 */
export interface PoolLimits {
  max: number;
  /** Espera máxima por una conexión libre del pool. */
  connectionTimeoutMs: number;
  /** Tiempo máximo de una consulta (PostgreSQL la cancela). */
  statementTimeoutMs: number;
  /** Espera máxima por un bloqueo. */
  lockTimeoutMs: number;
  /** Transacción abierta sin hacer nada (fuga de conexión): PostgreSQL la cierra. */
  idleInTransactionTimeoutMs: number;
  applicationName: string;
}

export function createPool(connectionString: string, limits?: PoolLimits): Db {
  if (!limits) return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  return new pg.Pool({
    connectionString, max: limits.max, idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: limits.connectionTimeoutMs,
    statement_timeout: limits.statementTimeoutMs,
    lock_timeout: limits.lockTimeoutMs,
    idle_in_transaction_session_timeout: limits.idleInTransactionTimeoutMs,
    application_name: limits.applicationName,
  });
}

/** Errores que significan "sistema saturado": se responde 503 con reintento, no 500. */
export function isOverloadError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  // 57014 consulta cancelada por statement_timeout; 55P03 lock_timeout; 53300 demasiadas conexiones.
  if (e?.code === "57014" || e?.code === "55P03" || e?.code === "53300") return true;
  return typeof e?.message === "string" && /timeout exceeded when trying to connect/i.test(e.message);
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
