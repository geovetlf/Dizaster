import type { Db } from "./db.js";

/** Roles del worker que deben latir (mismos que `worker-roles.ts`). */
export type HeartbeatRole = "urgent" | "normal" | "maintenance";
const ROLES: HeartbeatRole[] = ["urgent", "normal", "maintenance"];

export interface ReadinessLimits {
  /** Un rol sin latido más reciente que esto se considera detenido. */
  staleSeconds: number;
  /** Evento de dominio listo para procesar más viejo que esto: el outbox no avanza. */
  outboxMaxAgeSeconds: number;
}
export const DEFAULT_READINESS: ReadinessLimits = { staleSeconds: 90, outboxMaxAgeSeconds: 300 };

export interface Readiness {
  ready: boolean;
  database: boolean;
  /** Segundos desde el último latido de cada rol (cualquier instancia); null = nunca latió. */
  roles: Record<HeartbeatRole, number | null>;
  outboxOldestReadySeconds: number | null;
  problems: string[];
}

/**
 * Latido del worker y disponibilidad (ADR 0187, §5.22, §13.1). Cada bucle late tras cada vuelta: si una vuelta se
 * cuelga, el latido deja de avanzar aunque el proceso siga vivo. NO AI REQUIRED.
 */
export class HeartbeatService {
  constructor(private readonly db: Db, private readonly limits: ReadinessLimits = DEFAULT_READINESS) {}

  async beat(instanceId: string, role: HeartbeatRole): Promise<void> {
    await this.db.query(
      `INSERT INTO platform.worker_heartbeats (instance_id, role) VALUES ($1, $2)
       ON CONFLICT (instance_id, role) DO UPDATE SET beat_at = now()`,
      [instanceId, role],
    );
  }

  /** Para el healthcheck del contenedor del worker: ¿esta instancia late en todos sus roles? */
  async instanceAlive(instanceId: string, roles: HeartbeatRole[]): Promise<boolean> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform.worker_heartbeats
        WHERE instance_id = $1 AND role = ANY($2) AND beat_at > now() - make_interval(secs => $3)`,
      [instanceId, roles, this.limits.staleSeconds],
    );
    return rows[0]!.n === roles.length;
  }

  async readiness(): Promise<Readiness> {
    const problems: string[] = [];
    const roles = { urgent: null, normal: null, maintenance: null } as Record<HeartbeatRole, number | null>;
    try {
      const beats = await this.db.query<{ role: HeartbeatRole; age: number }>(
        `SELECT role, extract(epoch FROM now() - max(beat_at))::float8 AS age FROM platform.worker_heartbeats GROUP BY role`,
      );
      for (const b of beats.rows) roles[b.role] = Math.round(b.age);
      const outbox = await this.db.query<{ age: number | null }>(
        `SELECT extract(epoch FROM now() - min(available_at))::float8 AS age FROM platform.outbox
          WHERE processed_at IS NULL AND available_at <= now()`,
      );
      const oldest = outbox.rows[0]!.age;
      const outboxOldestReadySeconds = oldest === null ? null : Math.round(oldest);
      for (const r of ROLES) {
        const age = roles[r];
        if (age === null) problems.push(`worker.${r}.never`);
        else if (age > this.limits.staleSeconds) problems.push(`worker.${r}.stale`);
      }
      if (outboxOldestReadySeconds !== null && outboxOldestReadySeconds > this.limits.outboxMaxAgeSeconds) problems.push("outbox.stuck");
      return { ready: problems.length === 0, database: true, roles, outboxOldestReadySeconds, problems };
    } catch {
      return { ready: false, database: false, roles, outboxOldestReadySeconds: null, problems: ["database"] };
    }
  }

  /** Instancias que ya no existen (réplicas recreadas): fuera tras un día. */
  async prune(): Promise<number> {
    const r = await this.db.query(`DELETE FROM platform.worker_heartbeats WHERE beat_at < now() - interval '1 day'`);
    return r.rowCount ?? 0;
  }
}
