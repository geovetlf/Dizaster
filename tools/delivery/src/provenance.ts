import type { ArtifactManifest } from "./artifact.js";

/**
 * Procedencia SLSA v1 (in-toto Statement v1) de una imagen (Blueprint §20.11, ADR 0277). Se genera de forma
 * determinística a partir del manifiesto del artefacto y del contexto de GitHub Actions; cosign la firma y la adjunta a
 * la imagen ("attest"). Al desplegar se comprueba que diga lo mismo que el manifiesto: mismo digest, mismo commit,
 * mismo repositorio, construida por un workflow permitido.
 */
export interface Provenance {
  _type: "https://in-toto.io/Statement/v1";
  subject: { name: string; digest: { sha256: string } }[];
  predicateType: "https://slsa.dev/provenance/v1";
  predicate: {
    buildDefinition: {
      buildType: string;
      externalParameters: { workflow: { ref: string; repository: string; path: string } };
      internalParameters: { tests: string; security: string; sbomDigest?: string | undefined };
      resolvedDependencies: { uri: string; digest: { gitCommit: string } }[];
    };
    runDetails: {
      builder: { id: string };
      metadata: { invocationId: string; startedOn: string };
    };
  };
}

export const BUILD_TYPE = "https://github.com/actions/runner/dizaster-image@v1";

export interface BuildContext {
  repository: string; // owner/repo
  ref: string; // refs/heads/main
  workflowPath: string; // .github/workflows/ci.yml
  runId: string;
  runAttempt: string;
  serverUrl?: string | undefined;
}

export function contextFromEnv(env: NodeJS.ProcessEnv): BuildContext | null {
  const repository = env["GITHUB_REPOSITORY"];
  const ref = env["GITHUB_REF"];
  const workflowRef = env["GITHUB_WORKFLOW_REF"]; // owner/repo/.github/workflows/ci.yml@refs/heads/main
  const runId = env["GITHUB_RUN_ID"];
  if (!repository || !ref || !workflowRef || !runId) return null;
  const path = workflowRef.slice(repository.length + 1).split("@")[0]!;
  return { repository, ref, workflowPath: path, runId, runAttempt: env["GITHUB_RUN_ATTEMPT"] ?? "1", serverUrl: env["GITHUB_SERVER_URL"] };
}

export function buildProvenance(m: ArtifactManifest, image: string, ctx: BuildContext): Provenance {
  if (!m.imageDigest) throw new Error("el manifiesto no tiene digest de imagen");
  const server = ctx.serverUrl ?? "https://github.com";
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: image, digest: { sha256: m.imageDigest.slice("sha256:".length) } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: BUILD_TYPE,
        externalParameters: { workflow: { ref: ctx.ref, repository: `${server}/${ctx.repository}`, path: ctx.workflowPath } },
        internalParameters: { tests: m.tests, security: m.security, sbomDigest: m.sbomDigest },
        resolvedDependencies: [{ uri: `git+${server}/${ctx.repository}@${ctx.ref}`, digest: { gitCommit: m.commit } }],
      },
      runDetails: {
        builder: { id: `${server}/${ctx.repository}/${ctx.workflowPath}@${ctx.ref}` },
        metadata: { invocationId: `${server}/${ctx.repository}/actions/runs/${ctx.runId}/attempts/${ctx.runAttempt}`, startedOn: m.builtAt },
      },
    },
  };
}

export interface ProvenanceExpectation {
  digest: string;
  commit?: string | undefined;
  repository?: string | null | undefined;
  workflows?: string[] | undefined;
  refs?: string[] | undefined;
}

const refMatches = (ref: string, patterns: string[]) =>
  patterns.some((p) => (p.endsWith("*") ? ref.startsWith(p.slice(0, -1)) : ref === p));

/** Lo que la procedencia debe afirmar para desplegar. Devuelve los problemas; vacío es válido. */
export function verifyProvenance(p: Provenance, e: ProvenanceExpectation): string[] {
  const problems: string[] = [];
  if (p._type !== "https://in-toto.io/Statement/v1") problems.push("no es un Statement in-toto v1");
  if (p.predicateType !== "https://slsa.dev/provenance/v1") problems.push("no es procedencia SLSA v1");
  if (p.predicate?.buildDefinition?.buildType !== BUILD_TYPE) problems.push("tipo de build desconocido");
  const want = e.digest.replace(/^sha256:/, "");
  if (!p.subject?.some((s) => s.digest?.sha256 === want)) problems.push(`la procedencia no es de ${e.digest}`);
  const bd = p.predicate?.buildDefinition;
  const commit = bd?.resolvedDependencies?.[0]?.digest?.gitCommit;
  if (e.commit && commit !== e.commit) problems.push(`commit distinto (${commit ?? "—"} ≠ ${e.commit})`);
  if (bd?.internalParameters?.tests !== "passed") problems.push("las pruebas no pasaron");
  if (bd?.internalParameters?.security !== "passed") problems.push("la seguridad no pasó");
  const wf = bd?.externalParameters?.workflow;
  if (e.repository && !wf?.repository?.endsWith(`/${e.repository}`)) problems.push(`repositorio distinto (${wf?.repository ?? "—"})`);
  if (e.workflows && !e.workflows.includes(wf?.path ?? "")) problems.push(`workflow no permitido (${wf?.path ?? "—"})`);
  if (e.refs && !refMatches(wf?.ref ?? "", e.refs)) problems.push(`ref no permitida (${wf?.ref ?? "—"})`);
  return problems;
}
