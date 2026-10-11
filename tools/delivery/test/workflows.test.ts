import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `pnpm check:workflows` (ADR 0264, 0308, 0338) sobre una copia del repositorio con un cambio que debe rechazar.
const root = new URL("../../../", import.meta.url).pathname;
const COPY = [".github", "infra/docker", "infra/tofu", ".nvmrc", "package.json"];

function checkWith(edit: (read: (f: string) => string, write: (f: string, s: string) => void) => void) {
  const dir = mkdtempSync(join(tmpdir(), "dzd-wf-"));
  for (const p of COPY) cpSync(join(root, p), join(dir, p), { recursive: true, filter: (src) => !src.includes(".terraform") });
  edit((f) => readFileSync(join(dir, f), "utf8"), (f, s) => writeFileSync(join(dir, f), s));
  const r = spawnSync(process.execPath, [join(root, "scripts/check-workflows.mjs")], { cwd: dir, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const swap = (f: string, from: string | RegExp, to: string) => (read: (f: string) => string, write: (f: string, s: string) => void) => {
  const text = read(f);
  const next = text.replace(from, to);
  if (next === text) throw new Error(`el texto a cambiar no está en ${f}: ${String(from)}`);
  write(f, next);
};

describe("check:workflows", () => {
  it("el repositorio tal cual pasa", () => {
    expect(checkWith(() => undefined)).toMatchObject({ status: 0 });
  });

  it("rechaza permisos de escritura en la raíz", () => {
    const r = checkWith(swap(".github/workflows/ci.yml", /^permissions:\n {2}contents: read/m, "permissions:\n  contents: write"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("ci.yml: `permissions:` de la raíz con escritura");
    expect(checkWith(swap(".github/workflows/mobile-build.yml", /^permissions:\n {2}contents: read/m, "permissions: write-all")).status).toBe(1);
  });

  it("rechaza pull_request_target y workflow_run", () => {
    const r = checkWith(swap(".github/workflows/ci.yml", /^ {2}pull_request:$/m, "  pull_request_target:"));
    expect(r.out).toContain("pull_request_target");
    expect(r.status).toBe(1);
  });

  it("rechaza una acción por etiqueta y un job sin límite de tiempo", () => {
    expect(checkWith(swap(".github/workflows/ci.yml", "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7")).out).toContain("no está fijado por SHA");
    expect(checkWith(swap(".github/workflows/mobile-build.yml", /^ {4}timeout-minutes: 30\n/m, "")).out).toContain("`build` no tiene `timeout-minutes`");
  });

  it("id-token: write solo en los jobs que firman o despliegan", () => {
    const r = checkWith(swap(".github/workflows/ci.yml", /( {2}supply-chain:\n {4}runs-on: ubuntu-24.04\n)/, "$1    permissions:\n      contents: read\n      id-token: write\n"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("`supply-chain` pide `id-token: write`");
  });

  it("rechaza entradas del disparador interpoladas dentro de un script", () => {
    const r = checkWith(swap(".github/workflows/mobile-build.yml", '--platform "$PLATFORM"', '--platform "${{ inputs.platform }}"'));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/mobile-build\.yml:\d+: entrada no confiable/);
  });

  it("la entrega no pierde la aprobación de producción ni la guarda de entornos", () => {
    const cases: [string | RegExp, string, string][] = [
      ["    environment: production\n", "", "environment: production"],
      ["    needs: staging\n", "    needs: guard\n", "needs: staging"],
      ["    needs: guard\n", "", "needs: guard"],
      ['read_api "repos/$REPO/environments/production" production.json', "true", "leer el entorno production"],
      ["cancel-in-progress: false", "cancel-in-progress: true", "cancel-in-progress: false"],
      ["--outcome approval --execute", "--execute", "--outcome approval"],
      [/ {6}- name: Autonomía del actor \(antes de migrar o desplegar\)\n.*\n/, "", "staging: `dzd guard --action migrate-staging`"],
      [/ {6}- name: Autonomía del actor \(antes de migrar o promover\)\n.*\n/, "", "production: `dzd guard --action migrate-production`"],
    ];
    for (const [from, to, expected] of cases) {
      const r = checkWith(swap(".github/workflows/deliver.yml", from, to));
      expect(r.status, String(from)).toBe(1);
      expect(r.out, String(from)).toContain(expected);
    }
  });

  it("Node desalineado entre .nvmrc y engines falla (ADR 0308)", () => {
    const r = checkWith(swap(".nvmrc", /^22/, "26"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("no coincide con .nvmrc (26)");
  });
});
