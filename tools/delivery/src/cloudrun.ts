import type { DeployTarget, Revision } from "./deploy.js";

/** Ejecuta un comando y devuelve su salida. En `--dry-run` solo lo imprime. */
export type Runner = (cmd: string, args: string[]) => Promise<string>;

export interface CloudRunConfig { project: string; region: string; service: string; image: string }

/**
 * Cloud Run con `gcloud` (Blueprint §20.13, ADR 0261). No se ejecuta contra la nube hasta que existan los proyectos y
 * su facturación (D-18, BLOQUEADA): mientras tanto se usa en `--dry-run` y en pruebas con un Runner falso.
 * Se despliega por digest (`imagen@sha256:…`), nunca por etiqueta.
 */
export class CloudRunTarget implements DeployTarget {
  constructor(private readonly cfg: CloudRunConfig, private readonly run: Runner) {}

  private base(): string[] {
    return ["--project", this.cfg.project, "--region", this.cfg.region, "--quiet"];
  }

  async current(): Promise<Revision | null> {
    const out = await this.run("gcloud", ["run", "services", "describe", this.cfg.service, ...this.base(), "--format=json"]);
    if (!out.trim()) return null;
    const svc = JSON.parse(out) as { status?: { traffic?: { revisionName?: string; percent?: number }[] }; spec?: { template?: { spec?: { containers?: { image?: string }[] } } } };
    const main = svc.status?.traffic?.find((t) => t.percent === 100);
    if (!main?.revisionName) return null;
    const image = svc.spec?.template?.spec?.containers?.[0]?.image ?? "";
    return { name: main.revisionName, digest: image.split("@")[1] ?? "" };
  }

  async deploy(digest: string): Promise<Revision> {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("solo se despliega por digest sha256");
    const out = await this.run("gcloud", ["run", "deploy", this.cfg.service, `--image=${this.cfg.image}@${digest}`, "--no-traffic", "--tag=candidate", ...this.base(), "--format=json"]);
    const res = out.trim() ? JSON.parse(out) as { status?: { latestCreatedRevisionName?: string; url?: string } } : {};
    return { name: res.status?.latestCreatedRevisionName ?? "candidate", digest, url: res.status?.url };
  }

  async shift(rev: Revision, percent: number): Promise<void> {
    if (percent < 0 || percent > 100) throw new Error("porcentaje fuera de rango");
    await this.run("gcloud", ["run", "services", "update-traffic", this.cfg.service, `--to-revisions=${rev.name}=${percent}`, ...this.base()]);
  }
}
