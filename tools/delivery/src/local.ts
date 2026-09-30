import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { dirname } from "node:path";
import type { Runner } from "./cloudrun.js";
import type { DeployTarget, Revision } from "./deploy.js";

/**
 * Destino local (ADR 0282): el mismo camino deploy → verificación → 10 % → 100 % → rollback que Cloud Run, sobre
 * contenedores de Docker en esta máquina y un proxy local que reparte el tráfico. Sirve para ensayar la entrega
 * completa sin nube, sin facturación y sin credenciales. Nunca apunta a staging ni a producción.
 */
export interface LocalRevision { digest: string; port: number; container: string }
export interface LocalState { revisions: Record<string, LocalRevision>; traffic: { name: string; percent: number }[] }

export interface LocalConfig {
  /** Archivo de estado (revisiones y reparto de tráfico); lo lee el proxy en cada petición. */
  state: string;
  /** Imagen: vacío para usar el id local (`sha256:…`) tal cual; si no, `imagen@digest`. */
  image: string;
  /** Archivo de variables del contenedor (DATABASE_URL, AUTH_JWT_SECRET…). */
  envFile?: string | undefined;
  /** Primer puerto para las revisiones (cada una usa el siguiente libre del estado). */
  basePort: number;
  /** Espera a que `/health` responda antes de verificar la candidata. */
  waitHealthy?: ((url: string) => Promise<boolean>) | undefined;
}

export function readState(path: string): LocalState {
  if (!existsSync(path)) return { revisions: {}, traffic: [] };
  return JSON.parse(readFileSync(path, "utf8")) as LocalState;
}

function writeState(path: string, s: LocalState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(s, null, 2)}\n`);
}

/** Reparto de tráfico: `rev` recibe `percent`; el resto, la revisión que servía el 100 % (o la mayor). */
export function applyShift(s: LocalState, name: string, percent: number): LocalState["traffic"] {
  if (percent < 0 || percent > 100 || !Number.isInteger(percent)) throw new Error("porcentaje fuera de rango");
  if (!s.revisions[name]) throw new Error(`revisión desconocida: ${name}`);
  if (percent === 100) return [{ name, percent: 100 }];
  const stable = [...s.traffic].filter((t) => t.name !== name).sort((a, b) => b.percent - a.percent)[0];
  if (!stable) throw new Error("no hay revisión estable para repartir el tráfico");
  return [{ name, percent }, { name: stable.name, percent: 100 - percent }];
}

/**
 * Reparto determinístico: la petición `i` va a la revisión cuyo tramo acumulado contiene `i mod 100`. Con 10 %, 10 de
 * cada 100 peticiones seguidas van a la candidata. Sin azar: el resultado se puede reproducir en una prueba.
 */
export function pickRevision(traffic: LocalState["traffic"], i: number): string | null {
  const slot = ((i % 100) + 100) % 100;
  let acc = 0;
  for (const t of traffic) {
    acc += t.percent;
    if (slot < acc) return t.name;
  }
  return traffic.at(-1)?.name ?? null;
}

/** Revisiones que se pueden borrar: todas salvo la que sirve y la anterior (para poder volver). */
export function prunable(s: LocalState, serving: string, previous: string | null): string[] {
  return Object.keys(s.revisions).filter((n) => n !== serving && n !== previous);
}

export class LocalDockerTarget implements DeployTarget {
  constructor(private readonly cfg: LocalConfig, private readonly run: Runner) {}

  async current(): Promise<Revision | null> {
    const s = readState(this.cfg.state);
    const main = s.traffic.find((t) => t.percent === 100);
    const r = main ? s.revisions[main.name] : undefined;
    return main && r ? { name: main.name, digest: r.digest, url: `http://127.0.0.1:${r.port}` } : null;
  }

  async deploy(digest: string): Promise<Revision> {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("solo se despliega por digest sha256");
    const s = readState(this.cfg.state);
    const used = new Set(Object.values(s.revisions).map((r) => r.port));
    let port = this.cfg.basePort;
    while (used.has(port)) port++;
    const name = `dz-local-${digest.slice(7, 19)}-${port}`;
    const ref = this.cfg.image ? `${this.cfg.image}@${digest}` : digest;
    await this.run("docker", ["run", "-d", "--name", name, "--network", "host", "-e", `PORT=${port}`,
      ...(this.cfg.envFile ? ["--env-file", this.cfg.envFile] : []), "--label", "dizaster.delivery=local", "--no-healthcheck", ref]);
    s.revisions[name] = { digest, port, container: name };
    writeState(this.cfg.state, s);
    const url = `http://127.0.0.1:${port}`;
    // Si no arranca, la verificación de candidata la rechaza (y queda en la auditoría): aquí solo se espera.
    if (this.cfg.waitHealthy) await this.cfg.waitHealthy(url);
    return { name, digest, url };
  }

  async shift(rev: Revision, percent: number): Promise<void> {
    let s = readState(this.cfg.state);
    // Rollback a una revisión cuyo contenedor ya no existe: se vuelve a levantar el mismo digest (nunca se reconstruye).
    if (!s.revisions[rev.name]) {
      const again = await this.deploy(rev.digest);
      s = readState(this.cfg.state);
      rev = again;
    }
    // La que servía antes de este paso: la de más tráfico que no es `rev` (con 10 % en curso, la del 90 %).
    const before = [...s.traffic].filter((t) => t.name !== rev.name).sort((a, b) => b.percent - a.percent)[0]?.name ?? null;
    // Primer despliegue: no hay a quién repartir; la candidata recibe todo al primer paso.
    s.traffic = s.traffic.length === 0 ? [{ name: rev.name, percent: 100 }] : applyShift(s, rev.name, percent);
    writeState(this.cfg.state, s);
    if (percent !== 100) return;
    // Quedan la que sirve y la anterior; el resto se detiene y se borra (nunca la base de datos).
    for (const n of prunable(s, rev.name, before)) {
      await this.run("docker", ["rm", "-f", s.revisions[n]!.container]);
      delete s.revisions[n];
    }
    writeState(this.cfg.state, s);
  }
}

/** Espera `/health` 200 hasta `timeoutMs`. */
export async function waitHealthy(url: string, timeoutMs = 60_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(new URL("/health", url));
      if (r.status === 200) return true;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Proxy local: lee el estado en cada petición y reenvía según el reparto. Agrega `x-dz-revision` a la respuesta para
 * ver qué revisión contestó. Solo escucha en 127.0.0.1.
 */
export function startProxy(statePath: string, port: number): Server {
  let i = 0;
  const server = createServer((req, res) => {
    const s = readState(statePath);
    const name = pickRevision(s.traffic, i++);
    const rev = name ? s.revisions[name] : undefined;
    if (!rev) { res.writeHead(503, { "content-type": "application/json" }).end('{"error":"NO_REVISION"}'); return; }
    const up = request({ host: "127.0.0.1", port: rev.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, "x-dz-revision": name! });
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "x-dz-revision": name! }); res.end(); });
    req.pipe(up);
  });
  server.listen(port, "127.0.0.1");
  return server;
}
