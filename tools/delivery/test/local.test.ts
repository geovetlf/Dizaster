import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rollbackTo, rollout } from "../src/deploy.js";
import { runLoad } from "../src/load.js";
import { applyShift, LocalDockerTarget, pickRevision, prunable, readState, startProxy, type LocalState } from "../src/local.js";
import { evaluateSlo, fromK6Summary, fromSamples } from "../src/slo.js";
import type { CheckResult } from "../src/verify.js";

// Destino local y carga mínima (ADR 0282). Docker se reemplaza por un Runner falso: nada se ejecuta de verdad.
const root = new URL("../../../", import.meta.url).pathname;
const D = (c: string) => `sha256:${c.repeat(64)}`;
const ok: CheckResult[] = [{ name: "vivo", ok: true, ms: 1, detail: "ok" }];
const bad: CheckResult[] = [{ name: "vivo", ok: false, ms: 1, detail: "estado 500" }];

function target() {
  const calls: string[][] = [];
  const state = join(mkdtempSync(join(tmpdir(), "dzd-local-")), "state.json");
  const t = new LocalDockerTarget({ state, image: "", basePort: 18080 }, async (c, a) => { calls.push([c, ...a]); return ""; });
  return { t, calls, state };
}

describe("reparto de tráfico local", () => {
  const s: LocalState = { revisions: { a: { digest: D("a"), port: 1, container: "a" }, b: { digest: D("b"), port: 2, container: "b" } }, traffic: [{ name: "a", percent: 100 }] };

  it("10 % a la candidata, 90 % a la que servía; 100 % deja solo la candidata", () => {
    expect(applyShift(s, "b", 10)).toEqual([{ name: "b", percent: 10 }, { name: "a", percent: 90 }]);
    expect(applyShift(s, "b", 100)).toEqual([{ name: "b", percent: 100 }]);
  });

  it("rechaza porcentajes inválidos y revisiones desconocidas", () => {
    expect(() => applyShift(s, "b", 101)).toThrow(/rango/);
    expect(() => applyShift(s, "b", 12.5)).toThrow(/rango/);
    expect(() => applyShift(s, "z", 10)).toThrow(/desconocida/);
  });

  it("el reparto es determinístico: exactamente 10 de cada 100 peticiones van a la candidata", () => {
    const traffic = [{ name: "b", percent: 10 }, { name: "a", percent: 90 }];
    const picks = Array.from({ length: 200 }, (_, i) => pickRevision(traffic, i));
    expect(picks.filter((p) => p === "b")).toHaveLength(20);
    expect(pickRevision([], 0)).toBeNull();
  });

  it("al podar quedan la que sirve y la anterior", () => {
    const three = { ...s, revisions: { ...s.revisions, c: { digest: D("c"), port: 3, container: "c" } } };
    expect(prunable(three, "c", "b")).toEqual(["a"]);
  });
});

describe("destino Docker local", () => {
  it("primer despliegue: por digest, en host, puerto propio, sin healthcheck de la imagen", async () => {
    const { t, calls, state } = target();
    const r = await rollout(t, D("1"), async () => ok);
    expect(r.outcome).toBe("deployed");
    expect(calls[0]).toEqual(["docker", "run", "-d", "--name", `dz-local-${"1".repeat(12)}-18080`, "--network", "host", "-e", "PORT=18080", "--label", "dizaster.delivery=local", "--no-healthcheck", D("1")]);
    expect(readState(state).traffic).toEqual([{ name: r.revision.name, percent: 100 }]);
  });

  it("solo acepta digests sha256", async () => {
    await expect(target().t.deploy("latest")).rejects.toThrow(/digest/);
  });

  it("despliegue gradual: conserva la anterior para volver y borra las más viejas", async () => {
    const { t, calls, state } = target();
    await rollout(t, D("1"), async () => ok);
    await rollout(t, D("2"), async () => ok);
    const r3 = await rollout(t, D("3"), async () => ok);
    expect(r3.outcome).toBe("deployed");
    const st = readState(state);
    expect(Object.values(st.revisions).map((x) => x.digest).sort()).toEqual([D("2"), D("3")]);
    expect(calls.filter((c) => c[1] === "rm")).toEqual([["docker", "rm", "-f", `dz-local-${"1".repeat(12)}-18080`]]);
  });

  it("si falla con tráfico, el 100 % vuelve a la anterior; si falla como candidata, nunca recibe tráfico", async () => {
    const { t, state } = target();
    const first = await rollout(t, D("1"), async () => ok);
    const rolled = await rollout(t, D("2"), async (_r, stage) => (stage === 10 ? bad : ok));
    expect(rolled.outcome).toBe("rolled-back");
    expect(readState(state).traffic).toEqual([{ name: first.revision.name, percent: 100 }]);
    const rejected = await rollout(t, D("3"), async (_r, stage) => (stage === "candidate" ? bad : ok));
    expect(rejected.outcome).toBe("rejected");
    expect(readState(state).traffic).toEqual([{ name: first.revision.name, percent: 100 }]);
  });

  it("rollback a una revisión ya borrada: levanta otra vez el mismo digest, sin reconstruir", async () => {
    const { t, calls, state } = target();
    const first = await rollout(t, D("1"), async () => ok);
    await rollout(t, D("2"), async () => ok);
    await rollout(t, D("3"), async () => ok);
    await rollbackTo(t, first.revision);
    const st = readState(state);
    const serving = st.traffic[0]!;
    expect(serving.percent).toBe(100);
    expect(st.revisions[serving.name]!.digest).toBe(D("1"));
    expect(calls.filter((c) => c[1] === "run").at(-1)?.at(-1)).toBe(D("1"));
    expect(calls.some((c) => c.includes("build"))).toBe(false);
  });

  it("con imagen de registro despliega imagen@digest", async () => {
    const calls: string[][] = [];
    const state = join(mkdtempSync(join(tmpdir(), "dzd-local-")), "s.json");
    const t = new LocalDockerTarget({ state, image: "127.0.0.1:5055/dizaster/core", envFile: "local.env", basePort: 19000 }, async (c, a) => { calls.push([c, ...a]); return ""; });
    await t.deploy(D("4"));
    expect(calls[0]).toContain(`127.0.0.1:5055/dizaster/core@${D("4")}`);
    expect(calls[0]).toContain("local.env");
  });
});

describe("proxy local y carga", () => {
  it("el proxy reparte según el estado y marca qué revisión respondió", async () => {
    const mk = (tag: string) => new Promise<{ port: number; close: () => void }>((res) => {
      const s = createServer((_q, r) => { r.writeHead(tag === "b" ? 500 : 200).end(tag); }).listen(0, "127.0.0.1", () => res({ port: (s.address() as AddressInfo).port, close: () => s.close() }));
    });
    const [a, b] = [await mk("a"), await mk("b")];
    const state = join(mkdtempSync(join(tmpdir(), "dzd-proxy-")), "s.json");
    writeFileSync(state, JSON.stringify({ revisions: { a: { digest: D("a"), port: a.port, container: "a" }, b: { digest: D("b"), port: b.port, container: "b" } }, traffic: [{ name: "b", percent: 10 }, { name: "a", percent: 90 }] }));
    const proxy = startProxy(state, 0);
    await new Promise((r) => proxy.once("listening", r));
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const samples = await runLoad({ url, requests: 100, concurrency: 1, paths: ["/health"] });
      expect(samples.filter((s) => s.status === 500)).toHaveLength(10);
      const one = await fetch(`${url}/health`);
      expect(one.headers.get("x-dz-revision")).toMatch(/^[ab]$/);
      writeFileSync(state, JSON.stringify({ revisions: {}, traffic: [] }));
      expect((await fetch(`${url}/health`)).status).toBe(503);
    } finally {
      proxy.close(); a.close(); b.close();
    }
  });

  it("la carga reparte las rutas, respeta la concurrencia y cuenta los fallos de red como estado 0", async () => {
    let inFlight = 0, max = 0;
    const fetcher = async (u: string) => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      if (u.endsWith("/down")) throw new Error("ECONNREFUSED");
      return { status: 200, text: async () => "" };
    };
    const s = await runLoad({ url: "http://x", requests: 40, concurrency: 4, paths: ["/a", "/down"], fetcher });
    expect(s).toHaveLength(40);
    expect(max).toBeLessThanOrEqual(4);
    expect(s.filter((x) => x.status === 0)).toHaveLength(20);
    await expect(runLoad({ url: "http://x", requests: 0, concurrency: 1 })).rejects.toThrow(/requests/);
    await expect(runLoad({ url: "http://x", requests: 1, concurrency: 1000 })).rejects.toThrow(/concurrency/);
  });

  it("CLI: `deploy --env local` en seco imprime docker run sin tocar nada; un entorno desconocido se rechaza", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-cli-"));
    const r = spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, "deploy", "--env", "local", "--digest", D("5"), "--state", join(dir, "s.json"), "--releases", join(dir, "r.jsonl"), "--log", join(dir, "a.jsonl"), "--policy", `${root}delivery/policy.json`], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\[en seco\] docker run -d/);
    expect(r.stdout).toMatch(/firma no exigida/);
    const x = spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, "deploy", "--env", "qa", "--digest", D("5")], { cwd: dir, encoding: "utf8" });
    expect(x.status).toBe(1);
    expect(x.stderr).toMatch(/staging, production o local/);
  });
});

describe("SLO con límite por IP", () => {
  const targets = { apiP95Ms: 300, maxErrorRate: null, minSamples: 20 };

  it("un 429 no es un error de servidor: se informa aparte y no bloquea", () => {
    const o = fromSamples([...Array.from({ length: 30 }, () => ({ ms: 5, status: 200 })), ...Array.from({ length: 10 }, () => ({ ms: 1, status: 429 }))]);
    expect(o.serverErrors).toBe(0);
    expect(o.rateLimited).toBe(10);
    const r = evaluateSlo(o, targets, { smoke: true });
    expect(r.ok).toBe(true);
    expect(r.findings.find((f) => f.check === "límite por IP")?.detail).toMatch(/10 de 40 respuestas 429/);
  });

  it("k6 con los contadores de infra/load/smoke.js: usa server_errors y rate_limited, no http_req_failed", () => {
    const o = fromK6Summary({ metrics: { http_reqs: { count: 750 }, http_req_duration: { "p(95)": 4 }, http_req_failed: { value: 0.7 }, server_errors: { count: 0 }, rate_limited: { count: 534 } } });
    expect(o.serverErrors).toBe(0);
    expect(o.errorRate).toBe(0);
    expect(o.rateLimited).toBe(534);
    expect(evaluateSlo(o, targets, { smoke: true }).ok).toBe(true);
  });

  it("un 5xx sigue bloqueando la prueba de humo", () => {
    const o = fromK6Summary({ metrics: { http_reqs: { count: 100 }, http_req_duration: { "p(95)": 4 }, server_errors: { count: 1 } } });
    expect(evaluateSlo(o, targets, { smoke: true }).ok).toBe(false);
  });
});
