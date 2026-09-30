/** Failure Analyzer determinístico (Blueprint §20.24): clasifica la salida de un gate rojo por patrones conocidos. */
export type FailureKind =
  | "typecheck" | "lint" | "test" | "boundaries" | "secret" | "workflow" | "supply-chain" | "migration" | "policy"
  | "infra-runner" | "timeout" | "unknown";

export interface Diagnosis { kind: FailureKind; summary: string; retryable: boolean; hints: string[] }

const RULES: [FailureKind, RegExp, string, boolean][] = [
  ["infra-runner", /(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOSPC|runner (lost|has received a shutdown)|No space left on device|429 Too Many Requests)/i, "falló la infraestructura del runner o la red antes de las pruebas", true],
  ["timeout", /(timed? ?out after|exceeded the maximum execution time|Test timed out)/i, "tiempo agotado", false],
  ["secret", /posible (clave|token)|archivo de credenciales versionado/i, "posible secreto en el repositorio", false],
  ["workflow", /Workflows sin endurecer/i, "workflow sin permisos mínimos o acción sin fijar", false],
  ["boundaries", /Violaciones de fronteras/i, "frontera de módulo rota", false],
  ["policy", /Política inválida|la política bloquea/i, "la política rechaza el cambio", false],
  ["migration", /(migración|migration).*(destructiva|no se edita)/i, "migración destructiva o editada", false],
  ["supply-chain", /(licencia no permitida|avisos? (high|critical)|vulnerabilit)/i, "dependencia con licencia o aviso de seguridad no permitido", false],
  ["typecheck", /error TS\d{4}/, "error de tipos", false],
  ["lint", /\d+ problems? \(\d+ errors?/i, "error de lint", false],
  ["test", /(FAIL\s|AssertionError|Tests\s+\d+ failed)/, "prueba fallida", false],
];

export function diagnose(log: string): Diagnosis {
  for (const [kind, re, summary, retryable] of RULES) {
    if (re.test(log)) {
      const hints = log.split("\n").filter((l) => re.test(l) || /error TS\d{4}|FAIL |AssertionError|✗|×/.test(l)).slice(0, 10).map((l) => l.trim());
      return { kind, summary, retryable, hints };
    }
  }
  return { kind: "unknown", summary: "fallo sin patrón conocido: revisar el log", retryable: false, hints: log.split("\n").slice(-10) };
}
