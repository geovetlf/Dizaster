import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderImage, type RenderedImage } from "./images.js";
import { MalformedMediaError, sanitize, videoInfo, type MediaFamily, type SanitizeResult, type VideoInfo } from "./sanitize.js";

type Redactions = readonly { x: number; y: number; w: number; h: number }[];

/**
 * Decodificación de lo que sube la gente (ADR 0194, §13.1). Todo archivo subido es hostil hasta probar lo contrario:
 * se parsea y re-codifica fuera del proceso del worker, con tiempo y memoria limitados.
 */
export interface MediaDecoder {
  sanitize(family: MediaFamily, data: Uint8Array): Promise<SanitizeResult>;
  videoInfo(data: Uint8Array): Promise<VideoInfo>;
  renderImage(data: Uint8Array, redactions?: Redactions): Promise<RenderedImage>;
  close(): Promise<void>;
}

/** En el mismo proceso: solo para desarrollo y pruebas unitarias. */
export const inProcessDecoder: MediaDecoder = {
  sanitize: async (family, data) => sanitize(family, data),
  videoInfo: async (data) => videoInfo(data),
  renderImage: (data, redactions = []) => renderImage(data, redactions),
  close: async () => undefined,
};

export interface IsolatedDecoderOptions {
  /** Tiempo máximo por archivo: al vencer se mata el proceso y el archivo se rechaza. */
  timeoutMs: number;
  /** Tope del heap de JS del proceso hijo (la memoria nativa la acota además el límite de píxeles de sharp). */
  maxOldSpaceMb: number;
  /** Se recicla el proceso cada N archivos (fugas de memoria nativa). */
  recycleAfter?: number;
}

type Job = { op: "sanitize"; family: MediaFamily; data: Uint8Array } | { op: "videoInfo"; data: Uint8Array } | { op: "renderImage"; data: Uint8Array; redactions: Redactions };
type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; malformed: boolean; message: string };

/** Un proceso hijo, un archivo a la vez (el worker ya procesa media de uno en uno). */
export class IsolatedDecoder implements MediaDecoder {
  private child: ChildProcess | null = null;
  private seq = 0;
  private done = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: IsolatedDecoderOptions) {}

  sanitize(family: MediaFamily, data: Uint8Array): Promise<SanitizeResult> {
    return this.run({ op: "sanitize", family, data }).then((v) => {
      const r = v as SanitizeResult;
      return { ...r, data: new Uint8Array(r.data) };
    });
  }

  videoInfo(data: Uint8Array): Promise<VideoInfo> {
    return this.run({ op: "videoInfo", data }) as Promise<VideoInfo>;
  }

  renderImage(data: Uint8Array, redactions: Redactions = []): Promise<RenderedImage> {
    return this.run({ op: "renderImage", data, redactions }).then((v) => {
      const r = v as RenderedImage;
      return { ...r, variants: r.variants.map((x) => ({ ...x, data: Buffer.from(x.data) })) };
    });
  }

  async close(): Promise<void> {
    this.kill();
  }

  /** De uno en uno: si un archivo cuelga el proceso, solo ese se rechaza. */
  private run(job: Job): Promise<unknown> {
    const next = this.queue.then(() => this.send(job), () => this.send(job));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private send(job: Job): Promise<unknown> {
    const child = this.ensureChild();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        reject(new MalformedMediaError(`sin terminar en ${Math.round(this.opts.timeoutMs / 1000)} s`));
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, ...job });
    });
  }

  private ensureChild(): ChildProcess {
    if (this.child && this.done >= (this.opts.recycleAfter ?? 200)) this.kill();
    if (this.child) return this.child;
    const here = fileURLToPath(import.meta.url);
    const fromSource = here.endsWith(".ts");
    const entry = here.replace(/decoder\.(ts|js)$/, `decoder-child.${fromSource ? "ts" : "js"}`);
    const child = fork(entry, [], {
      serialization: "advanced",
      execArgv: [...(fromSource ? ["--import", "tsx"] : []), `--max-old-space-size=${this.opts.maxOldSpaceMb}`],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { NODE_ENV: process.env["NODE_ENV"] ?? "production", PATH: process.env["PATH"] ?? "" },
    });
    child.on("message", (m: Reply) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      this.done++;
      if (m.ok) p.resolve(m.value);
      else p.reject(m.malformed ? new MalformedMediaError(m.message) : new Error(m.message));
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      // Murió a mitad de un archivo (p. ej. un fallo nativo al decodificar): ese archivo se rechaza.
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new MalformedMediaError("el decodificador terminó de forma inesperada"));
        this.pending.delete(id);
      }
    });
    // El hijo no mantiene vivo al proceso principal (un archivo en curso sí, por su temporizador).
    child.unref();
    child.channel?.unref();
    this.child = child;
    this.done = 0;
    return child;
  }

  private kill(): void {
    const c = this.child;
    this.child = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new MalformedMediaError("decodificación interrumpida"));
      this.pending.delete(id);
    }
    if (c && c.exitCode === null) c.kill("SIGKILL");
  }
}
