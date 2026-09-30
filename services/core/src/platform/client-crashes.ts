import { createHash } from "node:crypto";
import type { ClientCrashEntry, ClientCrashGroup, ClientCrashesResponse } from "@dizaster/contracts";
import type { Db } from "./db.js";
import { newId } from "./ids.js";

/** Plataforma y versión declaradas por la app; cualquier otra cosa se descarta. */
const PLATFORMS = new Set(["android", "ios"]);
const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** Números largos (líneas, columnas, ids) cambian entre versiones: fuera de la huella para agrupar lo mismo. */
export function crashFingerprint(message: string, stack: string | null): string {
  const frame = firstFrame(stack) ?? "";
  const norm = (s: string) => s.replace(/\d+/g, "#");
  return createHash("sha256").update(`${norm(message)}\n${norm(frame)}`).digest("hex").slice(0, 16);
}

function firstFrame(stack: string | null): string | null {
  return stack?.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? null;
}

/**
 * Informes de fallos de la app autoalojados (ADR 0173): sustituyen a un SDK de terceros mientras no haya DSN. No se
 * guarda cuenta ni IP; el cupo general por IP de la API limita el abuso y además cada envío trae como mucho 20.
 */
export class ClientCrashService {
  constructor(private readonly db: Db) {}

  async record(entries: readonly ClientCrashEntry[], platform: unknown, appVersion: unknown, now: Date): Promise<number> {
    const p = typeof platform === "string" && PLATFORMS.has(platform) ? platform : null;
    const v = typeof appVersion === "string" && VERSION.test(appVersion) ? appVersion : null;
    // Una fecha del futuro (reloj mal puesto) se guarda como la de recepción.
    const rows = entries.map((e) => {
      const at = new Date(e.at);
      return [newId(), crashFingerprint(e.message, e.stack), e.message, e.where, e.stack, e.requestId ?? null, p, v, at > now ? now : at];
    });
    for (const r of rows) {
      await this.db.query(
        `INSERT INTO platform.client_crashes (id, fingerprint, message, location, stack, request_id, platform, app_version, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, r,
      );
    }
    return rows.length;
  }

  async summary(days: number, limit = 50): Promise<ClientCrashesResponse> {
    const { rows } = await this.db.query<{
      fingerprint: string; message: string; location: string | null; stack: string | null; platforms: (string | null)[];
      versions: (string | null)[]; count: number; first_at: Date; last_at: Date; last_request: string | null;
    }>(
      `SELECT fingerprint, (array_agg(message ORDER BY received_at DESC))[1] AS message,
              (array_agg(location ORDER BY received_at DESC))[1] AS location, (array_agg(stack ORDER BY received_at DESC))[1] AS stack,
              array_agg(DISTINCT platform) AS platforms, array_agg(DISTINCT app_version) AS versions, count(*)::int AS count,
              min(occurred_at) AS first_at, max(occurred_at) AS last_at,
              (array_agg(request_id ORDER BY received_at DESC) FILTER (WHERE request_id IS NOT NULL))[1] AS last_request
         FROM platform.client_crashes WHERE received_at >= now() - make_interval(days => $1)
        GROUP BY fingerprint ORDER BY count(*) DESC, max(occurred_at) DESC LIMIT $2`,
      [days, limit],
    );
    const groups: ClientCrashGroup[] = rows.map((r) => ({
      fingerprint: r.fingerprint, message: r.message, where: r.location, firstFrame: firstFrame(r.stack),
      platforms: r.platforms.filter((x): x is string => x !== null).sort(),
      appVersions: r.versions.filter((x): x is string => x !== null).sort(),
      count: r.count, firstAt: r.first_at.toISOString(), lastAt: r.last_at.toISOString(), lastRequestId: r.last_request,
    }));
    return { days, total: groups.reduce((n, g) => n + g.count, 0), groups };
  }

  /** Retención (ADR 0173): lo recibido hace más de `days` días se borra. */
  async applyRetention(days: number): Promise<number> {
    const r = await this.db.query(`DELETE FROM platform.client_crashes WHERE received_at < now() - make_interval(days => $1)`, [days]);
    return r.rowCount ?? 0;
  }
}
