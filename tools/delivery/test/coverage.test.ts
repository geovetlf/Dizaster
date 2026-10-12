import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDocs } from "../src/docs.js";
import { globToRegExp } from "../src/glob.js";
import { analyze, parseNameStatus, type WorkspacePackage } from "../src/inspect.js";
import { planGates } from "../src/plan.js";
import { classifyPath, loadPolicy, outcomeFor } from "../src/policy.js";

// Cobertura de la clasificación de riesgo sobre el repositorio real (auditoría del Frente D, ADR 0337). NO AI REQUIRED.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const pkgs: WorkspacePackage[] = [
  { name: "@dizaster/core", dir: "services/core", deps: [] },
  { name: "@dizaster/mobile", dir: "apps/mobile", deps: [] },
];
const run = (lines: string, files: Record<string, string> = {}) =>
  analyze(parseNameStatus(lines), policy, { pkgs, readFile: (p) => files[p] ?? readFileSync(`${root}${p}`, "utf8") });

// Nombres reservados: hoy no hay archivos con ese nombre, pero si se crean deben nacer críticos.
const RESERVED = ["services/core/src/platform/auth*.ts", "services/core/src/platform/crypto*.ts", "apps/mobile/src/lib/emergency/**"];

describe("cobertura de la política sobre el repositorio", () => {
  it("cada glob cubre al menos un archivo versionado (salvo nombres reservados): una regla muerta da falsa seguridad", () => {
    const dead = policy.rules.flatMap((r) => r.paths).filter((g) => !RESERVED.includes(g) && !tracked.some((f) => globToRegExp(g).test(f)));
    expect(dead).toEqual([]);
  });

  it("todo el código de los módulos sensibles del backend es crítico", () => {
    const sensitive = ["identity", "report", "event", "alert", "verification", "ingestion", "moderation", "trust", "media"];
    const files = tracked.filter((f) => sensitive.some((m) => f.startsWith(`services/core/src/modules/${m}/`)));
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => classifyPath(policy, f).class !== "critical")).toEqual([]);
  });

  it("cifrado, autenticación de la API, logs sin datos personales y su contraparte móvil son críticos", () => {
    for (const f of ["services/core/src/platform/field-cipher.ts", "services/core/src/http/app.ts", "services/core/src/http/log.ts",
      "services/core/src/platform/config.ts", "services/core/src/platform/rate-limit.ts", "apps/mobile/src/lib/auth/mfa.ts",
      "apps/mobile/src/lib/report/anonymity.ts", "apps/mobile/src/lib/media/redaction.ts", "apps/mobile/src/lib/emergency.ts",
      "apps/mobile/src/lib/emergency-store.ts", "data/source-registry/sources.json", "data/emergency-numbers/emergency-numbers.json"]) {
      if (!tracked.includes(f)) continue;
      expect(classifyPath(policy, f).class, f).toBe("critical");
    }
    expect(tracked).toContain("services/core/src/platform/field-cipher.ts");
    expect(tracked).toContain("apps/mobile/src/lib/emergency.ts");
  });

  it("workflows, Dependabot, IaC, la política, los chequeos y los gates de seguridad son críticos", () => {
    const files = tracked.filter((f) => /^(\.github\/|infra\/|delivery\/|tools\/delivery\/src\/|security\/)/.test(f) || /^scripts\/check-.*\.mjs$/.test(f));
    expect(files).toContain(".github/dependabot.yml");
    expect(files.filter((f) => classifyPath(policy, f).class !== "critical")).toEqual([]);
  });

  it("todas las migraciones son críticas; las últimas (0108–0110) piden regresión completa, restauración y ADR", () => {
    const migrations = readdirSync(`${root}services/core/migrations`).filter((f) => f.endsWith(".sql"));
    expect(migrations.filter((f) => classifyPath(policy, `services/core/migrations/${f}`).class !== "critical")).toEqual([]);
    for (const f of ["0108_suspension_durations.sql", "0109_comment_notices.sql", "0110_public_corroborated_count.sql"]) {
      const im = run(`A\tservices/core/migrations/${f}`);
      expect(im.risk, f).toBe("critical");
      expect(im.migrationFindings.every((m) => m.class === "critical"), f).toBe(true);
      expect(im.fullRegression).toBe(true);
      expect(planGates(im).map((g) => g.id)).toEqual(expect.arrayContaining(["test", "restore"]));
      expect(outcomeFor(policy, im.risk, "production")).toBe("approval");
      expect(checkDocs([`services/core/migrations/${f}`], policy.docRules)).not.toEqual([]);
    }
  });
});

describe("renombres y borrados", () => {
  it("mover un archivo crítico a una ruta de bajo riesgo sigue siendo crítico", () => {
    const im = run("R100\tservices/core/src/modules/identity/index.ts\tdocs/identity-old.md", { "docs/identity-old.md": "" });
    expect(im.risk).toBe("critical");
    expect(im.areas.docsOnly).toBe(false);
    expect(im.reasons.join()).toMatch(/origen services\/core\/src\/modules\/identity\/index\.ts/);
    expect(run("R090\t.github/workflows/ci.yml\tdocs/ci.yml.md", { "docs/ci.yml.md": "" }).risk).toBe("critical");
  });

  it("sacar una migración de su carpeta es como borrarla: bloqueado", () => {
    const im = run("R100\tservices/core/migrations/0001_init.sql\tdocs/0001_init.sql", { "docs/0001_init.sql": "" });
    expect(im.risk).toBe("blocked");
    expect(run("D\tservices/core/migrations/0001_init.sql").risk).toBe("blocked");
  });

  it("borrar un workflow es crítico (quitar un gate no es de bajo riesgo)", () => {
    expect(run("D\t.github/workflows/deliver.yml").risk).toBe("critical");
  });
});
