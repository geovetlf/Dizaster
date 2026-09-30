/**
 * Validación de un entorno antes de planificar o desplegar (Blueprint §20.9, ADR 0277). Sin red ni credenciales: lee
 * las variables que el entorno de OpenTofu exige, el tfvars que las completa y el archivo de configuración del runtime,
 * y dice qué falta o está mal. Los valores del propietario nunca se inventan: un marcador `<…>` es "falta".
 */
export interface EnvFinding { severity: "block" | "warn"; where: string; message: string }

/** Variables declaradas en un main.tf y si tienen valor por defecto. */
export function declaredVariables(hcl: string): { name: string; required: boolean }[] {
  const out: { name: string; required: boolean }[] = [];
  const re = /^variable\s+"([^"]+)"\s*\{/gm;
  for (const m of hcl.matchAll(re)) {
    // Cuerpo hasta la llave que cierra, contando llaves.
    let depth = 0;
    let end = m.index!;
    for (let i = m.index! + m[0].length - 1; i < hcl.length; i++) {
      if (hcl[i] === "{") depth++;
      else if (hcl[i] === "}" && --depth === 0) { end = i; break; }
    }
    const body = hcl.slice(m.index!, end);
    out.push({ name: m[1]!, required: !/^\s*default\s*=/m.test(body) });
  }
  return out;
}

/** Claves de primer nivel de un tfvars y su texto (un objeto multilínea se toma entero). */
export function tfvarsEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    let value = m[2]!;
    if (/[{[]\s*$/.test(value)) {
      let depth = (value.match(/[{[]/g)?.length ?? 0) - (value.match(/[}\]]/g)?.length ?? 0);
      while (depth > 0 && i + 1 < lines.length) {
        const l = lines[++i]!;
        value += `\n${l}`;
        depth += (l.match(/[{[]/g)?.length ?? 0) - (l.match(/[}\]]/g)?.length ?? 0);
      }
    }
    entries.set(m[1]!, value.replace(/\s+#.*$/gm, "").trim());
  }
  return entries;
}

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|_KEY$|APIKEY|API_KEY|DSN|CREDENTIAL)/i;
const DATABASE_URL_WITH_PASSWORD = /^postgres(ql)?:\/\/[^:/@]+:[^@]+@/;

export interface EnvCheckInput {
  env: "staging" | "production";
  mainTf: string;
  tfvars?: string | undefined;
  runtimeEnv?: Record<string, string> | undefined;
  /** signing.repository de la política: el tfvars debe apuntar al mismo repositorio. */
  repository?: string | null | undefined;
  /** tfvars del otro entorno, para comprobar que no comparten proyecto. */
  otherTfvars?: string | undefined;
}

const unquote = (v: string | undefined) => v?.replace(/^"(.*)"$/s, "$1");

export function checkEnvironment(i: EnvCheckInput): EnvFinding[] {
  const f: EnvFinding[] = [];
  const tf = `infra/tofu/envs/${i.env}`;
  if (i.tfvars !== undefined) {
    const vars = tfvarsEntries(i.tfvars);
    for (const v of declaredVariables(i.mainTf)) {
      const val = vars.get(v.name);
      if (val === undefined) { if (v.required) f.push({ severity: "block", where: tf, message: `falta ${v.name}` }); continue; }
      if (/<[^>]+>/.test(val)) f.push({ severity: "block", where: tf, message: `${v.name} tiene un marcador sin completar` });
    }
    const image = unquote(vars.get("image"));
    if (image && !/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(image)) f.push({ severity: "block", where: tf, message: "image debe ir por digest (…@sha256:…), nunca por etiqueta" });
    const url = unquote(vars.get("public_api_url"));
    if (url && !url.startsWith("https://")) f.push({ severity: "block", where: tf, message: "public_api_url debe ser https" });
    const repo = unquote(vars.get("github_repository"));
    if (repo && i.repository && repo !== i.repository) f.push({ severity: "block", where: tf, message: `github_repository (${repo}) no coincide con signing.repository (${i.repository})` });
    if (i.repository === null) f.push({ severity: "warn", where: "delivery/policy.json", message: "signing.repository es null (D-24): no se podrá verificar la firma de ninguna imagen" });
    for (const [k, v] of vars) {
      if (SECRET_NAME.test(k) && !/<[^>]+>/.test(v)) f.push({ severity: "block", where: tf, message: `${k} parece un secreto: va en Secret Manager, nunca en tfvars` });
    }
    const min = Number(vars.get("api_min_instances"));
    const max = Number(vars.get("api_max_instances"));
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) f.push({ severity: "block", where: tf, message: "api_min_instances > api_max_instances" });
    if (i.otherTfvars !== undefined) {
      const other = unquote(tfvarsEntries(i.otherTfvars).get("project_id"));
      const mine = unquote(vars.get("project_id"));
      if (mine && other && mine === other && !/<[^>]+>/.test(mine)) f.push({ severity: "block", where: tf, message: "staging y production no pueden compartir proyecto" });
    }
  }
  if (i.runtimeEnv) {
    for (const [k, v] of Object.entries(i.runtimeEnv)) {
      if (SECRET_NAME.test(k) && v && !v.startsWith("secret:")) f.push({ severity: "block", where: "configuración", message: `${k} lleva un valor en claro: se declara como secret:<id>` });
      if (k === "DATABASE_URL" && DATABASE_URL_WITH_PASSWORD.test(v)) f.push({ severity: "block", where: "configuración", message: "DATABASE_URL con contraseña en claro: se declara como secret:<id>" });
      if (/<[^>]+>/.test(v)) f.push({ severity: "block", where: "configuración", message: `${k} tiene un marcador sin completar` });
    }
    if (i.env === "production" && i.runtimeEnv["NODE_ENV"] !== undefined && i.runtimeEnv["NODE_ENV"] !== "production") {
      f.push({ severity: "block", where: "configuración", message: "NODE_ENV debe ser production" });
    }
  }
  return f;
}
