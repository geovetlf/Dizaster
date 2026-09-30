import type { CheckResult } from "./verify.js";

export interface Revision { name: string; digest: string; url?: string | undefined }

/**
 * Destino de despliegue (Environment Manager + Deployment Engine). Hoy: Cloud Run (`cloudrun.ts`, sin ejecutar hasta
 * que existan los proyectos, D-18) y un destino en memoria para pruebas. GKE u otro destino implementan lo mismo.
 */
export interface DeployTarget {
  /** Revisión que hoy sirve el 100 % del tráfico (null si es el primer despliegue). */
  current(): Promise<Revision | null>;
  /** Crea una revisión con el digest, sin tráfico. */
  deploy(digest: string): Promise<Revision>;
  /** Porcentaje de tráfico a una revisión; el resto queda en la anterior. */
  shift(rev: Revision, percent: number): Promise<void>;
}

export type Verifier = (rev: Revision, stage: "candidate" | number) => Promise<CheckResult[]>;

export interface RolloutResult {
  outcome: "deployed" | "rejected" | "rolled-back";
  revision: Revision;
  previous: Revision | null;
  steps: { stage: "candidate" | number; ok: boolean; failed: string[] }[];
}

/**
 * Despliegue gradual con rollback automático (Blueprint §20.13–20.15): revisión sin tráfico → verificación → cada
 * porcentaje → verificación. Si una verificación falla con tráfico, el 100 % vuelve a la revisión anterior (solo
 * tráfico: la base de datos no se toca, las migraciones son compatibles hacia atrás).
 */
export async function rollout(target: DeployTarget, digest: string, verify: Verifier, percents: number[] = [10, 100]): Promise<RolloutResult> {
  const previous = await target.current();
  const revision = await target.deploy(digest);
  const steps: RolloutResult["steps"] = [];
  const check = async (stage: "candidate" | number) => {
    const r = await verify(revision, stage);
    const failed = r.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
    steps.push({ stage, ok: failed.length === 0, failed });
    return failed.length === 0;
  };
  if (!(await check("candidate"))) return { outcome: "rejected", revision, previous, steps };
  for (const p of percents) {
    await target.shift(revision, p);
    if (!(await check(p))) {
      if (previous) await target.shift(previous, 100);
      return { outcome: "rolled-back", revision, previous, steps };
    }
  }
  return { outcome: "deployed", revision, previous, steps };
}

/** Rollback manual o por alerta: el tráfico vuelve a la revisión anterior verificada. */
export async function rollbackTo(target: DeployTarget, previous: Revision): Promise<void> {
  await target.shift(previous, 100);
}
