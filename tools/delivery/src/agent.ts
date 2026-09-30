import { decide, type Action } from "./autonomy.js";
import type { Impact } from "./inspect.js";
import { outcomeFor, type Outcome, type Policy } from "./policy.js";

/**
 * Delivery Agent (ADR 0283): una pieza OPCIONAL que propone qué hacer con un cambio. Nunca ejecuta nada por su cuenta
 * ni puede saltarse un gate: solo devuelve pasos de una lista cerrada de comandos de `dzd`, y el ejecutor
 * (`validateProposal`) vuelve a decidir cada paso con la política y el nivel de autonomía vigentes, fuerza la
 * identidad del agente y descarta cualquier bandera que no esté permitida. El Delivery Plane funciona igual sin agente.
 *
 * Hoy existe un agente determinístico (`RuleAgent`), sin IA ni red. Un agente con IA implementaría la misma interfaz
 * detrás del AI Core, apagado por defecto (ADR 0110): nada lo requiere.
 */
export interface AgentContext {
  impact: Impact;
  policy: Policy;
  env: "staging" | "production" | "local";
  /** Digest candidato, si ya hay una imagen construida. */
  digest?: string | undefined;
  /** ¿El último despliegue en este entorno terminó en rollback o fue rechazado? */
  lastOutcome?: "deployed" | "rejected" | "rolled-back" | "rollback" | "dry-run" | null;
}

/**
 * Comandos que un agente puede proponer, con la acción de autonomía que implican y las banderas que el agente puede
 * poner. Dónde se despliega (imagen, proyecto, región, URL, archivo de variables) no lo elige el agente: lo pone el
 * ejecutor desde la configuración de quien lo invoca (`inject`).
 */
export const AGENT_COMMANDS = {
  "run-gates": { action: "run-gates", flags: [] },
  policy: { action: null, flags: ["env"] },
  docs: { action: null, flags: [] },
  "iac-check": { action: null, flags: ["hcl"] },
  verify: { action: null, flags: ["repeat", "slo"] },
  "signature-verify": { action: null, flags: ["digest", "attestations", "env"] },
  deploy: { action: "deploy-staging", flags: ["env", "digest", "percents"] },
  promote: { action: "promote-production", flags: ["digest", "percents"] },
  rollback: { action: "rollback-staging", flags: ["env", "to"] },
  diagnose: { action: null, flags: ["log"] },
} as const satisfies Record<string, { action: Action | null; flags: readonly string[] }>;

/** Banderas que el ejecutor agrega por comando desde la configuración de quien lo invoca. */
const CHANGES = ["files", "base", "head", "worktree"] as const;
const INJECT: Partial<Record<string, readonly string[]>> = {
  policy: CHANGES,
  "run-gates": CHANGES,
  docs: CHANGES,
  verify: ["url"],
  "signature-verify": ["image"],
  deploy: ["image", "project", "region", "url", "env-file", "state", "base-port"],
  promote: ["image", "project", "region", "url"],
  rollback: ["project", "region", "env-file", "state", "image"],
};

export type AgentCommand = keyof typeof AGENT_COMMANDS;

export interface AgentStep { command: AgentCommand; flags: Record<string, string>; why: string }
export interface AgentProposal { agent: string; steps: AgentStep[]; stop?: { reason: string; needs: "owner-approval" | "review" | "human" } | undefined }

export interface DeliveryAgent {
  readonly name: string;
  propose(ctx: AgentContext): Promise<AgentProposal>;
}

/** Acción de autonomía real de un paso (deploy/rollback cambian según el entorno). */
function actionFor(step: AgentStep): Action | null {
  const base = AGENT_COMMANDS[step.command].action;
  if (step.command === "deploy" && step.flags["env"] === "production") return "promote-production";
  if (step.command === "rollback") return step.flags["env"] === "production" ? "rollback-production" : "rollback-staging";
  return base;
}

export interface ValidatedStep { step: AgentStep; argv: string[]; allowed: boolean; reason: string }

/**
 * El ejecutor no confía en el agente: comando de la lista, banderas de la lista, identidad `agent:<nombre>` impuesta,
 * `--execute` solo cuando la autonomía lo permite y la política del repositorio (no una que traiga el agente).
 * Un paso no permitido detiene los siguientes: el orden importa (no se despliega si los gates no corrieron).
 */
export function validateProposal(p: AgentProposal, policy: Policy, outcome: Outcome, execute: boolean, inject: Record<string, string> = {}): ValidatedStep[] {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(p.agent)) throw new Error("nombre de agente inválido");
  const out: ValidatedStep[] = [];
  let blocked = false;
  for (const step of p.steps) {
    const spec = AGENT_COMMANDS[step.command as AgentCommand];
    if (!spec) { out.push({ step, argv: [], allowed: false, reason: `comando fuera de la lista: ${String(step.command)}` }); blocked = true; continue; }
    const extra = Object.keys(step.flags).filter((f) => !(spec.flags as readonly string[]).includes(f));
    if (extra.length) { out.push({ step, argv: [], allowed: false, reason: `banderas no permitidas: ${extra.join(", ")}` }); blocked = true; continue; }
    const bad = Object.entries(step.flags).find(([, v]) => typeof v !== "string" || v.startsWith("--") || /[\n\0]/.test(v));
    if (bad) { out.push({ step, argv: [], allowed: false, reason: `valor inválido en --${bad[0]}` }); blocked = true; continue; }
    if (blocked) { out.push({ step, argv: [], allowed: false, reason: "un paso anterior no está permitido" }); continue; }
    const action = actionFor(step);
    const local = step.flags["env"] === "local";
    const d = action && !local ? decide(policy.autonomyLevel, action, outcome) : { allowed: true, reason: local ? "destino local" : "solo lectura o verificación" };
    const [cmd, ...sub] = step.command === "signature-verify" ? ["signature", "verify"] : [step.command];
    const injected = Object.entries(inject).filter(([k]) => k === "policy" || INJECT[step.command]?.includes(k));
    const argv = [cmd!, ...sub, ...[...Object.entries(step.flags), ...injected].flatMap(([k, v]) => (v === "true" ? [`--${k}`] : [`--${k}`, v])), "--actor", `agent:${p.agent}`];
    const mutates = ["deploy", "promote", "rollback"].includes(step.command);
    if (mutates && execute && d.allowed) argv.push("--execute");
    out.push({ step, argv, allowed: d.allowed, reason: d.reason });
    if (!d.allowed) blocked = true;
  }
  return out;
}

/**
 * Agente determinístico: reglas fijas sobre el impacto del cambio y el último resultado. Propone lo mismo que haría
 * una persona siguiendo el runbook, y se detiene donde la política pide a una persona.
 */
export class RuleAgent implements DeliveryAgent {
  readonly name = "rules";

  async propose(ctx: AgentContext): Promise<AgentProposal> {
    const steps: AgentStep[] = [];
    const { impact, policy, env } = ctx;
    if (ctx.lastOutcome === "rolled-back" || ctx.lastOutcome === "rejected") {
      return { agent: this.name, steps: [{ command: "diagnose", flags: { log: "delivery-audit.jsonl" }, why: "el último despliegue no quedó: primero entender por qué" }],
        stop: { reason: "no se vuelve a desplegar hasta revisar la causa del último fallo", needs: "human" } };
    }
    steps.push({ command: "policy", flags: env === "local" ? {} : { env }, why: `riesgo ${impact.risk}: qué exige la política` });
    steps.push({ command: "run-gates", flags: {}, why: "pruebas, tipos, lint y límites según lo que cambió" });
    if (!impact.areas.docsOnly) steps.push({ command: "docs", flags: {}, why: "cada cambio con su documentación" });
    if (impact.areas.infra) steps.push({ command: "iac-check", flags: { hcl: "infra/tofu/modules/base/main.tf" }, why: "cambió la infraestructura: IAM sin comodines ni permisos de más" });
    if (impact.areas.docsOnly) return { agent: this.name, steps, stop: { reason: "solo documentación: no hay nada que desplegar", needs: "human" } };
    if (!ctx.digest) return { agent: this.name, steps, stop: { reason: "no hay imagen construida: CI la publica en main", needs: "human" } };
    const outcome = env === "local" ? "auto" : outcomeFor(policy, impact.risk, env);
    if (outcome === "block") return { agent: this.name, steps, stop: { reason: "la política bloquea este cambio", needs: "human" } };
    if (env === "production") {
      steps.push({ command: "promote", flags: { digest: ctx.digest }, why: "mismo digest que pasó staging" });
      if (outcome !== "auto") return { agent: this.name, steps, stop: { reason: `producción con resultado "${outcome}": aprueba el propietario`, needs: "owner-approval" } };
    } else {
      if (env !== "local") steps.push({ command: "signature-verify", flags: { digest: ctx.digest, attestations: "true" }, why: "solo imágenes firmadas por CI" });
      steps.push({ command: "deploy", flags: { env, digest: ctx.digest }, why: "candidata sin tráfico, verificación, 10 %, 100 %" });
      steps.push({ command: "verify", flags: { repeat: "5", slo: "true" }, why: "SLO de la revisión: p95 < 300 ms y ningún 5xx" });
      if (outcome === "approval") return { agent: this.name, steps, stop: { reason: "cambio crítico: aprueba el propietario", needs: "owner-approval" } };
    }
    return { agent: this.name, steps };
  }
}
