import type { AuditRecord } from "./audit.js";

export interface DeliveryStats {
  deploys: number;
  failedDeploys: number;
  rollbacks: number;
  /** Proporción de despliegues que acabaron en rollback o rechazo (change failure rate). */
  changeFailureRate: number | null;
  /** Despliegues por semana en el periodo del registro. */
  deploysPerWeek: number | null;
  /** Mediana, en minutos, entre un despliegue fallido y el siguiente correcto del mismo entorno (MTTR). */
  medianRecoveryMinutes: number | null;
  byAction: Record<string, { ok: number; failed: number; blocked: number }>;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Métricas de entrega (Blueprint §20.21) calculadas solo con el registro de auditoría: frecuencia de despliegue, tasa
 * de fallos y tiempo de recuperación. Sin servicio externo.
 */
export function deliveryStats(records: AuditRecord[]): DeliveryStats {
  const byAction: DeliveryStats["byAction"] = {};
  for (const r of records) {
    const a = (byAction[r.action] ??= { ok: 0, failed: 0, blocked: 0 });
    if (r.result === "ok") a.ok++;
    else if (r.result === "blocked") a.blocked++;
    else if (r.result === "failed" || r.result === "rolled-back") a.failed++;
  }
  const deploys = records.filter((r) => r.action === "deploy" || r.action === "promote");
  const failed = deploys.filter((r) => r.result === "failed" || r.result === "rolled-back");
  const recoveries: number[] = [];
  for (const f of failed) {
    const next = deploys.find((d) => d.environment === f.environment && d.result === "ok" && d.at > f.at)
      ?? records.find((d) => d.action === "rollback" && d.environment === f.environment && d.result === "ok" && d.at >= f.at);
    if (next) recoveries.push((Date.parse(next.at) - Date.parse(f.at)) / 60_000);
  }
  const span = deploys.length > 1 ? (Date.parse(deploys.at(-1)!.at) - Date.parse(deploys[0]!.at)) / (7 * 86_400_000) : 0;
  return {
    deploys: deploys.length,
    failedDeploys: failed.length,
    rollbacks: records.filter((r) => r.action === "rollback").length,
    changeFailureRate: deploys.length ? failed.length / deploys.length : null,
    deploysPerWeek: span > 0 ? deploys.length / span : null,
    medianRecoveryMinutes: median(recoveries),
    byAction,
  };
}
