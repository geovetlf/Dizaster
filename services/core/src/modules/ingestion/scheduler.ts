import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { publish } from "../../platform/outbox.js";
import type { Clock } from "../../platform/clock.js";
import type { Db } from "../../platform/db.js";
import { newId } from "../../platform/ids.js";
import { FEED_ADAPTERS } from "./adapters/index.js";
import type { IngestionService } from "./index.js";
import type { StorageProvider } from "../media/index.js";

/** Archivo del crudo de cada respuesta (ADR 0075). */
export interface RawArchive {
  storage: StorageProvider;
  retentionDays: number;
}

export type Lane = "NORMAL" | "URGENT";

export interface FetchResult {
  status: number;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
}

/** Acceso HTTP detrás de una interfaz: en tests se usa un falso; en producción, fetch con límites. */
export interface HttpFetcher {
  get(url: string, validators: { etag: string | null; lastModified: string | null }): Promise<FetchResult>;
}

export class NodeHttpFetcher implements HttpFetcher {
  constructor(private readonly opts: { timeoutMs: number; maxBytes: number; userAgent: string } = { timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024, userAgent: "Dizaster-Ingestion/0.1 (+contacto pendiente)" }) {}

  async get(url: string, v: { etag: string | null; lastModified: string | null }): Promise<FetchResult> {
    const headers: Record<string, string> = { "user-agent": this.opts.userAgent };
    // Peticiones condicionales: si la fuente no cambió, responde 304 sin cuerpo (costo casi nulo).
    if (v.etag) headers["if-none-match"] = v.etag;
    if (v.lastModified) headers["if-modified-since"] = v.lastModified;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.opts.timeoutMs) });
    if (res.status === 304) return { status: 304 };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > this.opts.maxBytes) throw new Error(`Respuesta demasiado grande (${len} bytes)`);
    const body = await res.text();
    if (body.length > this.opts.maxBytes) throw new Error("Respuesta demasiado grande");
    return { status: res.status, body, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }
}

/**
 * Horario del carril NORMAL. Formatos soportados (subconjunto de cron, en UTC):
 *  - "M H * * *"   → una vez al día a H:M
 *  - "M *\/N * * *" → cada N horas en el minuto M
 * Devuelve el último instante programado ≤ now.
 */
export function lastScheduledAt(schedule: string, now: Date): Date {
  const m = /^(\d{1,2}) (\d{1,2}|\*\/(\d{1,2})) \* \* \*$/.exec(schedule.trim());
  const minute = m ? Number(m[1]) : 0;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, minute));
  if (m?.[3]) {
    const every = Math.max(1, Number(m[3]));
    const hour = Math.floor(now.getUTCHours() / every) * every;
    d.setUTCHours(hour);
    if (d > now) d.setUTCHours(hour - every);
    return d;
  }
  d.setUTCHours(m ? Number(m[2]) : 5);
  if (d > now) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

interface SourceRow {
  id: string; key: string; adapter: string; config: Record<string, unknown>; schedule_normal: string | null;
  urgent_capable: boolean; urgent_poll_seconds: number | null;
  etag_normal: string | null; last_modified_normal: string | null; etag_urgent: string | null; last_modified_urgent: string | null;
  last_normal_run_at: Date | null; last_urgent_run_at: Date | null; consecutive_failures: number | null; open_until: Date | null;
}

export interface RunSummary { sourceKey: string; lane: Lane; status: string; itemsSeen: number; itemsNew: number; itemsUrgent: number }

const BREAKER_THRESHOLD = 3;

/**
 * Las claves de fuentes (p. ej. la MAP_KEY de FIRMS) nunca van en `data/`: la URL lleva `{secret:SOURCE_KEY_…}` y el
 * valor sale del entorno. Sin el secreto la fuente falla con un mensaje claro (y el breaker la pausa).
 */
export function resolveSourceUrl(url: string, secrets: Readonly<Record<string, string | undefined>>): string {
  return url.replace(/\{secret:(SOURCE_KEY_[A-Z0-9_]+)\}/g, (_, name: string) => {
    const v = secrets[name];
    if (!v) throw new Error(`Falta el secreto ${name}`);
    return encodeURIComponent(v);
  });
}

/** Quita de un mensaje de error cualquier secreto que pudiera traer (una URL en un error de red). */
function redactSecrets(msg: string, secrets: Readonly<Record<string, string | undefined>>): string {
  let out = msg;
  for (const v of Object.values(secrets)) if (v && v.length >= 4) out = out.split(v).join("[secret]").split(encodeURIComponent(v)).join("[secret]");
  return out;
}

/**
 * Planificador de ingestión con dos carriles independientes:
 *  - URGENT: sondeo corto solo de fuentes críticas; solo ingiere lo que el adapter considera urgente.
 *  - NORMAL: una ejecución por horario (≈ 24 h); ingiere todo.
 * Circuit breaker por fuente: tras 3 fallos seguidos deja de consultarla con espera exponencial (máx. 6 h).
 */
export class IngestionScheduler {
  constructor(
    private readonly db: Db,
    private readonly ingestion: IngestionService,
    private readonly fetcher: HttpFetcher,
    private readonly clock: Clock,
    private readonly secrets: Readonly<Record<string, string | undefined>> = {},
    private readonly raw: RawArchive | null = null,
  ) {}

  async tick(): Promise<RunSummary[]> {
    const now = this.clock.now();
    const { rows } = await this.db.query<SourceRow>(
      `SELECT s.id, s.key, s.adapter, s.config, s.schedule_normal, s.urgent_capable, s.urgent_poll_seconds,
              st.etag_normal, st.last_modified_normal, st.etag_urgent, st.last_modified_urgent,
              st.last_normal_run_at, st.last_urgent_run_at, st.consecutive_failures, st.open_until
         FROM ingestion.sources s LEFT JOIN ingestion.source_state st ON st.source_id = s.id
        WHERE s.status = 'ACTIVE'
        ORDER BY s.key`,
    );
    const due: Array<{ s: SourceRow; lane: Lane }> = [];
    for (const s of rows) {
      if (!FEED_ADAPTERS.has(s.adapter)) continue;
      if (s.open_until && s.open_until > now) continue;
      if (s.urgent_capable && s.urgent_poll_seconds && (!s.last_urgent_run_at || now.getTime() - s.last_urgent_run_at.getTime() >= s.urgent_poll_seconds * 1000)) {
        due.push({ s, lane: "URGENT" });
      }
      if (!s.last_normal_run_at || s.last_normal_run_at < lastScheduledAt(s.schedule_normal ?? "0 5 * * *", now)) {
        due.push({ s, lane: "NORMAL" });
      }
    }
    // El carril URGENT va primero: un lote normal nunca retrasa una alerta.
    due.sort((a, b) => (a.lane === b.lane ? 0 : a.lane === "URGENT" ? -1 : 1));
    const out: RunSummary[] = [];
    for (const d of due) out.push(await this.run(d.s, d.lane, now));
    return out;
  }

  /**
   * Guarda la respuesta comprimida en object storage (clave privada, nunca pública) y la anota en la ejecución.
   * Si es idéntica a la última guardada de la fuente, reutiliza esa clave (fuentes sin ETag repiten mucho).
   * Un fallo del almacenamiento nunca frena la ingestión: el ítem entra igual, sin crudo.
   */
  private async archiveRaw(s: SourceRow, runId: string, body: string, now: Date): Promise<string | null> {
    if (!this.raw) return null;
    const sha = createHash("sha256").update(body).digest("hex");
    try {
      const last = (await this.db.query<{ raw_ref: string; raw_sha256: string }>(
        `SELECT raw_ref, raw_sha256 FROM ingestion.runs WHERE source_id = $1 AND raw_ref IS NOT NULL ORDER BY started_at DESC LIMIT 1`, [s.id],
      )).rows[0];
      let key = last?.raw_sha256 === sha ? last.raw_ref : null;
      if (!key) {
        key = `sources/raw/${s.key}/${now.toISOString().slice(0, 10)}/${runId}.json.gz`;
        await this.raw.storage.put(key, gzipSync(body), "application/gzip");
      }
      await this.db.query(`UPDATE ingestion.runs SET raw_ref = $2, raw_sha256 = $3 WHERE id = $1`, [runId, key, sha]);
      return key;
    } catch (err) {
      console.warn(JSON.stringify({ msg: "ingestion.raw.failed", source: s.key, error: redactSecrets(String(err), this.secrets).slice(0, 300) }));
      return null;
    }
  }

  /** Retención del crudo: borra los objetos que ninguna ejecución reciente usa y limpia sus referencias. */
  async applyRawRetention(now: Date = this.clock.now()): Promise<{ deleted: number }> {
    if (!this.raw) return { deleted: 0 };
    const { rows } = await this.db.query<{ raw_ref: string }>(
      `SELECT raw_ref FROM ingestion.runs WHERE raw_ref IS NOT NULL
        GROUP BY raw_ref HAVING max(started_at) < $1::timestamptz - make_interval(days => $2) LIMIT 500`,
      [now, this.raw.retentionDays],
    );
    let deleted = 0;
    for (const { raw_ref } of rows) {
      try {
        await this.raw.storage.delete(raw_ref);
      } catch {
        continue; // se reintenta en la próxima pasada
      }
      await this.db.query(`UPDATE ingestion.runs SET raw_ref = NULL WHERE raw_ref = $1`, [raw_ref]);
      await this.db.query(`UPDATE ingestion.external_items SET raw_ref = NULL WHERE raw_ref = $1`, [raw_ref]);
      deleted++;
    }
    return { deleted };
  }

  private async run(s: SourceRow, lane: Lane, now: Date): Promise<RunSummary> {
    const adapter = FEED_ADAPTERS.get(s.adapter)!;
    const runId = newId();
    await this.db.query(`INSERT INTO ingestion.runs (id, source_id, lane, started_at, status) VALUES ($1, $2, $3, $4, 'RUNNING')`, [runId, s.id, lane, now]);
    const summary: RunSummary = { sourceKey: s.key, lane, status: "OK", itemsSeen: 0, itemsNew: 0, itemsUrgent: 0 };
    const isUrgentLane = lane === "URGENT";
    try {
      const template = String(s.config["url"] ?? "");
      if (!template) throw new Error("Fuente sin URL configurada");
      const url = resolveSourceUrl(template, this.secrets);
      const res = await this.fetcher.get(url, {
        etag: isUrgentLane ? s.etag_urgent : s.etag_normal,
        lastModified: isUrgentLane ? s.last_modified_urgent : s.last_modified_normal,
      });
      let httpStatus = res.status;
      if (res.status === 304) {
        summary.status = "NOT_MODIFIED";
      } else if (res.status >= 200 && res.status < 300 && res.body !== undefined) {
        // El crudo se guarda antes de interpretarlo: si el adapter falla, queda lo que la fuente respondió.
        const rawRef = await this.archiveRaw(s, runId, res.body, now);
        const items = adapter.parse(res.body, s.config);
        summary.itemsSeen = items.length;
        for (const item of items) {
          const urgent = adapter.isUrgent(item, s.config);
          if (isUrgentLane && !urgent) continue; // lo no crítico espera al carril NORMAL
          const r = await this.ingestion.ingest(s.key, item, urgent ? "URGENT" : "NORMAL", rawRef);
          if (!r.duplicate) summary.itemsNew++;
          if (urgent) summary.itemsUrgent++;
        }
        for (const id of adapter.withdrawals?.(res.body, s.config) ?? []) await this.ingestion.withdraw(s.key, id, now);
      } else {
        httpStatus = res.status;
        throw new Error(`HTTP ${res.status}`);
      }
      await this.db.query(
        `INSERT INTO ingestion.source_state (source_id, ${isUrgentLane ? "etag_urgent, last_modified_urgent, last_urgent_run_at" : "etag_normal, last_modified_normal, last_normal_run_at"}, consecutive_failures, open_until)
         VALUES ($1, $2, $3, $4, 0, NULL)
         ON CONFLICT (source_id) DO UPDATE SET
           ${isUrgentLane ? "etag_urgent = coalesce($2, ingestion.source_state.etag_urgent), last_modified_urgent = coalesce($3, ingestion.source_state.last_modified_urgent), last_urgent_run_at = $4"
                          : "etag_normal = coalesce($2, ingestion.source_state.etag_normal), last_modified_normal = coalesce($3, ingestion.source_state.last_modified_normal), last_normal_run_at = $4"},
           consecutive_failures = 0, open_until = NULL, updated_at = now()`,
        [s.id, res.etag ?? null, res.lastModified ?? null, now],
      );
      // Volvió una fuente urgente que estaba con el breaker abierto: se avisa igual que cuando cayó.
      if (s.urgent_capable && (s.consecutive_failures ?? 0) >= BREAKER_THRESHOLD) {
        await publish(this.db, "SourceHealthChanged", { sourceKey: s.key, state: "RECOVERED", failures: 0, error: null, retryAt: null });
      }
      await this.db.query(
        `UPDATE ingestion.runs SET finished_at = now(), http_status = $2, items_seen = $3, items_new = $4, items_urgent = $5, status = $6 WHERE id = $1`,
        [runId, httpStatus, summary.itemsSeen, summary.itemsNew, summary.itemsUrgent, summary.status],
      );
    } catch (err) {
      summary.status = "FAILED";
      const failures = (s.consecutive_failures ?? 0) + 1;
      const openMinutes = failures >= BREAKER_THRESHOLD ? Math.min(5 * 2 ** (failures - BREAKER_THRESHOLD), 360) : 0;
      // No se marca el carril como ejecutado: se reintenta en el siguiente ciclo hasta que el breaker se abra.
      await this.db.query(
        `INSERT INTO ingestion.source_state (source_id, consecutive_failures, open_until)
         VALUES ($1, $2, CASE WHEN $3 > 0 THEN $4::timestamptz + make_interval(mins => $3) END)
         ON CONFLICT (source_id) DO UPDATE SET consecutive_failures = $2,
           open_until = CASE WHEN $3 > 0 THEN $4::timestamptz + make_interval(mins => $3) END, updated_at = now()`,
        [s.id, failures, openMinutes, now],
      );
      const error = redactSecrets(String(err instanceof Error ? err.message : err), this.secrets).slice(0, 2000);
      await this.db.query(`UPDATE ingestion.runs SET finished_at = now(), status = 'FAILED', error = $2 WHERE id = $1`, [runId, error]);
      // §9.2: el carril URGENT nunca se desactiva en silencio. Se avisa una vez, cuando el breaker se abre.
      if (s.urgent_capable && failures === BREAKER_THRESHOLD) {
        const retryAt = new Date(now.getTime() + openMinutes * 60_000).toISOString();
        await publish(this.db, "SourceHealthChanged", { sourceKey: s.key, state: "DEGRADED", failures, error: error.slice(0, 200), retryAt });
      }
    }
    return summary;
  }
}
