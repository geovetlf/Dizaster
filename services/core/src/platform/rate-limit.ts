import type { Queryable } from "./db.js";

/**
 * Límite de peticiones en memoria por ventana fija (ADR 0047). Protege la API de ráfagas y enumeración sin
 * servicios extra; con varias réplicas, las cuentas con sesión usan `SharedAccountLimiter` (ADR 0228).
 */
export class FixedWindowLimiter {
  private window = 0;
  private counts = new Map<string, number>();

  constructor(
    readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cuenta un intento. Devuelve los segundos hasta la próxima ventana si se pasa del límite, o null. */
  hit(key: string): number | null {
    const t = this.now();
    const w = Math.floor(t / this.windowMs);
    if (w !== this.window) {
      // Ventana nueva: se olvida todo (memoria acotada al número de claves activas en un minuto).
      this.window = w;
      this.counts = new Map();
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n <= this.limit) return null;
    return Math.max(1, Math.ceil(((w + 1) * this.windowMs - t) / 1000));
  }
}

/**
 * Límite por cuenta compartido entre réplicas (ADR 0228): un contador por cuenta y minuto en PostgreSQL, una sola
 * sentencia por petición. Guarda el id interno de la cuenta y dos números; nada más, y se borra al minuto siguiente.
 */
export class SharedAccountLimiter {
  private lastSweep = 0;

  constructor(
    private readonly db: Queryable,
    readonly limit: number,
    readonly writeLimit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cuenta una petición de la cuenta. Devuelve los segundos hasta la próxima ventana si se pasa de un cupo, o null. */
  async hit(userId: string, write: boolean): Promise<number | null> {
    const t = this.now();
    const w = Math.floor(t / this.windowMs);
    if (w !== this.lastSweep) {
      // Una vez por ventana y réplica: borra las ventanas viejas (la tabla queda en el número de cuentas activas).
      this.lastSweep = w;
      await this.db.query(`DELETE FROM platform.rate_counters WHERE win < $1`, [w]);
    }
    const { rows } = await this.db.query<{ all_count: number; write_count: number }>(
      `INSERT INTO platform.rate_counters (user_id, win, all_count, write_count) VALUES ($1, $2, 1, $3)
       ON CONFLICT (user_id, win) DO UPDATE SET all_count = rate_counters.all_count + 1,
         write_count = rate_counters.write_count + EXCLUDED.write_count
       RETURNING all_count, write_count`,
      [userId, w, write ? 1 : 0],
    );
    const r = rows[0]!;
    if (r.all_count <= this.limit && (!write || r.write_count <= this.writeLimit)) return null;
    return Math.max(1, Math.ceil(((w + 1) * this.windowMs - t) / 1000));
  }
}
