import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { globToRegExp } from "../src/glob.js";
import { analyze, parseNameStatus, withDependents, type WorkspacePackage } from "../src/inspect.js";
import { checkMigrations } from "../src/migrations.js";
import { planGates } from "../src/plan.js";
import { classifyPath, loadPolicy, outcomeFor, validatePolicy } from "../src/policy.js";

// Políticas, impacto y selección de gates del Delivery Plane (ADR 0265). NO AI REQUIRED.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const pkgs: WorkspacePackage[] = [
  { name: "@dizaster/contracts", dir: "packages/contracts", deps: [] },
  { name: "@dizaster/geo-kit", dir: "packages/geo-kit", deps: ["@dizaster/contracts"] },
  { name: "@dizaster/core", dir: "services/core", deps: ["@dizaster/contracts", "@dizaster/geo-kit"] },
  { name: "@dizaster/mobile", dir: "apps/mobile", deps: ["@dizaster/contracts", "@dizaster/geo-kit"] },
  { name: "@dizaster/delivery", dir: "tools/delivery", deps: [] },
];
const run = (lines: string, files: Record<string, string> = {}, ref?: string) =>
  analyze(parseNameStatus(lines), policy, { pkgs, readFile: (p) => files[p] ?? "", ...(ref ? { ref } : {}) });

describe("globs", () => {
  it("** cruza directorios, * no", () => {
    expect(globToRegExp("docs/**").test("docs/adr/0001.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("README.md")).toBe(true);
    expect(globToRegExp("*/*/package.json").test("services/core/package.json")).toBe(true);
    expect(globToRegExp("*/*/package.json").test("package.json")).toBe(false);
    expect(globToRegExp("apps/mobile/src/app/emergency*").test("apps/mobile/src/app/emergency.tsx")).toBe(true);
  });
});

describe("política del repositorio", () => {
  it("es válida y respeta sus invariantes", () => {
    expect(policy.autonomyLevel).toBe(2);
    expect(() => validatePolicy({ ...policy, outcomes: { ...policy.outcomes, blocked: { staging: "auto", production: "block" } } })).toThrow(/blocked/);
    expect(() => validatePolicy({ ...policy, outcomes: { ...policy.outcomes, critical: { staging: "auto", production: "auto" } } })).toThrow(/approval/);
    expect(() => validatePolicy({ ...policy, autonomyLevel: 9 })).toThrow(/autonomyLevel/);
  });

  it("clasifica por ruta: la clase más alta gana", () => {
    expect(classifyPath(policy, "docs/adr/0001-x.md").class).toBe("low");
    expect(classifyPath(policy, "services/core/test/feed.test.ts").class).toBe("low");
    expect(classifyPath(policy, "services/core/src/modules/social/index.ts").class).toBe("medium");
    expect(classifyPath(policy, "services/core/src/modules/identity/index.ts").class).toBe("critical");
    expect(classifyPath(policy, "infra/link-domain/README.md").class).toBe("critical");
    expect(outcomeFor(policy, "critical", "production")).toBe("approval");
    expect(outcomeFor(policy, "medium", "staging")).toBe("auto");
  });
});

describe("impacto", () => {
  it("solo documentación: riesgo bajo y solo gates baratos", () => {
    const im = run("M\tdocs/runbooks/README.md\nA\tdocs/adr/0999-x.md");
    expect(im).toMatchObject({ risk: "low", areas: { docsOnly: true }, fullRegression: false, packages: [] });
    expect(planGates(im).map((g) => g.id)).toEqual(["secrets", "workflows", "policy"]);
  });

  it("un cambio en contratos arrastra a sus dependientes y pide regresión completa", () => {
    const im = run("M\tpackages/contracts/src/social.ts");
    expect(im.affectedPackages).toEqual(["@dizaster/contracts", "@dizaster/core", "@dizaster/geo-kit", "@dizaster/mobile"]);
    expect(im.fullRegression).toBe(true);
    const ids = planGates(im).map((g) => g.id);
    expect(ids).toContain("test");
    expect(ids).toContain("mobile-bundle");
  });

  it("un cambio medio en un módulo prueba solo lo afectado", () => {
    const im = run("M\tservices/core/src/modules/social/index.ts");
    expect(im).toMatchObject({ risk: "medium", coreModules: ["social"], fullRegression: false });
    expect(planGates(im).filter((g) => g.stage === 3).map((g) => g.command)).toEqual(["pnpm --filter @dizaster/core test"]);
    expect(run("M\tservices/core/src/modules/social/index.ts", {}, "refs/heads/main").fullRegression).toBe(true);
  });

  it("dependientes transitivos", () => {
    expect(withDependents(["@dizaster/geo-kit"], pkgs)).toEqual(["@dizaster/core", "@dizaster/geo-kit", "@dizaster/mobile"]);
  });
});

describe("migraciones", () => {
  const opts = { dir: "services/core/migrations", derivedTables: ["geo.context_cache"] };
  const check = (sql: string, status: "A" | "M" = "A") => checkMigrations([{ path: "services/core/migrations/0999_x.sql", status }], () => sql, opts);

  it("aditiva: crítica pero no bloqueada", () => {
    expect(check("CREATE INDEX x ON social.posts (id); ALTER TABLE social.posts ADD COLUMN y text;").map((f) => f.class)).toEqual(["critical"]);
    expect(check("ALTER TABLE t ALTER COLUMN c DROP NOT NULL; ALTER TABLE t DROP CONSTRAINT k;").map((f) => f.class)).toEqual(["critical"]);
  });

  it("destructiva o editada: bloqueada", () => {
    expect(check("DROP TABLE social.posts;").some((f) => f.class === "blocked")).toBe(true);
    expect(check("ALTER TABLE social.posts DROP COLUMN text;").some((f) => f.class === "blocked")).toBe(true);
    expect(check("ALTER TABLE social.posts RENAME COLUMN a TO b;").some((f) => f.class === "blocked")).toBe(true);
    expect(check("TRUNCATE social.posts;").some((f) => f.class === "blocked")).toBe(true);
    expect(check("TRUNCATE geo.context_cache;").some((f) => f.class === "blocked")).toBe(false);
    expect(check("-- DROP TABLE social.posts\nSELECT 1;").some((f) => f.class === "blocked")).toBe(false);
    expect(check("SELECT 1;", "M")[0]).toMatchObject({ class: "blocked" });
  });

  it("todas las migraciones existentes pasan la regla de hoy como si fueran nuevas, salvo las destructivas conocidas", () => {
    const dir = `${root}services/core/migrations`;
    const blocked = readdirSync(dir).filter((f) =>
      checkMigrations([{ path: `services/core/migrations/${f}`, status: "A" }], () => readFileSync(`${dir}/${f}`, "utf8"), opts).some((x) => x.class === "blocked"));
    // Ninguna migración histórica borra tablas o columnas con datos (auditoría del 2026-09-30).
    expect(blocked).toEqual([]);
  });
});
