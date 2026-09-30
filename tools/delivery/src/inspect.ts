import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesAny } from "./glob.js";
import { checkMigrations, type MigrationFinding } from "./migrations.js";
import { classifyPath, maxClass, type Policy, type RiskClass } from "./policy.js";

export interface Change { path: string; status: "A" | "M" | "D" | "R"; oldPath?: string }
export interface WorkspacePackage { name: string; dir: string; deps: string[] }

export interface Impact {
  files: { path: string; status: Change["status"]; class: RiskClass; reasons: string[] }[];
  packages: string[];
  /** Paquetes cambiados más los que dependen de ellos (sus pruebas pueden romperse). */
  affectedPackages: string[];
  coreModules: string[];
  areas: { backend: boolean; mobile: boolean; contracts: boolean; migrations: boolean; infra: boolean; ci: boolean; delivery: boolean; dependencies: boolean; docsOnly: boolean };
  migrationFindings: MigrationFinding[];
  risk: RiskClass;
  reasons: string[];
  fullRegression: boolean;
}

/** Cambios entre dos refs (`base...head`), con renombres. */
export function gitChanges(base: string, head = "HEAD", cwd = "."): Change[] {
  const out = execFileSync("git", ["diff", "--name-status", "-M", `${base}...${head}`], { cwd, encoding: "utf8" });
  return parseNameStatus(out);
}

export function parseNameStatus(text: string): Change[] {
  return text.split("\n").filter(Boolean).map((line) => {
    const [st, a, b] = line.split("\t");
    const status = st!.charAt(0) as Change["status"];
    return status === "R" ? { path: b!, status, oldPath: a! } : { path: a!, status: (["A", "M", "D"].includes(status) ? status : "M") as Change["status"] };
  });
}

/** Paquetes del workspace (pnpm-workspace.yaml: patrones `dir/*`). */
export function workspacePackages(root = "."): WorkspacePackage[] {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const globs = [...yaml.matchAll(/^\s*-\s*([\w./-]+)\/\*\s*$/gm)].map((m) => m[1]!);
  const pkgs: WorkspacePackage[] = [];
  for (const g of globs) {
    const base = join(root, g);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const file = join(base, d, "package.json");
      if (!existsSync(file)) continue;
      const pj = JSON.parse(readFileSync(file, "utf8")) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.entries({ ...pj.dependencies, ...pj.devDependencies }).filter(([, v]) => v.startsWith("workspace:")).map(([k]) => k);
      pkgs.push({ name: pj.name, dir: `${g}/${d}`, deps });
    }
  }
  return pkgs;
}

function packageOf(path: string, pkgs: WorkspacePackage[]): WorkspacePackage | undefined {
  return pkgs.filter((p) => path.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** Cierre de dependientes: si cambia `contracts`, también `core` y `mobile`. */
export function withDependents(changed: string[], pkgs: WorkspacePackage[]): string[] {
  const out = new Set(changed);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of pkgs) if (!out.has(p.name) && p.deps.some((d) => out.has(d))) { out.add(p.name); grew = true; }
  }
  return [...out].sort();
}

/**
 * Impacto de un cambio (Repository Inspector + Change Detector + Impact Analyzer, Blueprint §20.2). Determinístico:
 * rutas, grafo del workspace y el contenido de las migraciones nuevas.
 */
export function analyze(changes: Change[], policy: Policy, opts: { pkgs: WorkspacePackage[]; readFile: (p: string) => string; ref?: string }): Impact {
  const files = changes.map((c) => ({ path: c.path, status: c.status, ...classifyPath(policy, c.path) }));
  const touched = changes.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path]));
  const packages = [...new Set(touched.map((p) => packageOf(p, opts.pkgs)?.name).filter((n): n is string => !!n))].sort();
  const coreModules = [...new Set(touched.map((p) => /^services\/core\/src\/modules\/([^/]+)\//.exec(p)?.[1]).filter((m): m is string => !!m))].sort();
  const has = (globs: string[]) => touched.some((p) => matchesAny(p, globs));
  const areas = {
    backend: has(["services/**"]),
    mobile: has(["apps/mobile/**"]),
    contracts: has(["packages/contracts/**"]),
    migrations: has([`${policy.migrations.dir}/**`]),
    infra: has(["infra/**"]),
    ci: has([".github/**"]),
    delivery: has(["tools/delivery/**", "delivery/**"]),
    dependencies: has(["**/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches/**"]),
    docsOnly: touched.length > 0 && touched.every((p) => matchesAny(p, ["docs/**", "**/*.md"])),
  };
  const migrationFindings = checkMigrations(changes, opts.readFile, policy.migrations);
  const risk = maxClass([...files.map((f) => f.class), ...migrationFindings.map((m) => m.class)]);
  const reasons = [...new Set([
    ...files.filter((f) => f.class === risk).flatMap((f) => f.reasons.map((r) => `${f.path}: ${r}`)),
    ...migrationFindings.filter((m) => m.class === risk).map((m) => `${m.file}: ${m.message}`),
  ])];
  const fullRegression = has(policy.fullRegression.paths) || risk === "critical" || risk === "blocked"
    || (!!opts.ref && policy.fullRegression.refs.some((r) => matchesAny(opts.ref!, [r])));
  return { files, packages, affectedPackages: withDependents(packages, opts.pkgs), coreModules, areas, migrationFindings, risk, reasons, fullRegression };
}
