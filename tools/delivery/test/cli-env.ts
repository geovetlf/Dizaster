/**
 * Entorno para llamar al CLI en las pruebas como lo haría una persona en su máquina: sin `GITHUB_ACTIONS` (en CI,
 * `--actor human` no cuenta como humano, ADR 0277) y comparando HEAD con HEAD, para que los gates que el CLI lance por
 * su cuenta no dependan del commit que esté probando CI.
 */
export function localEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DZD_BASE: "HEAD" };
  delete env["GITHUB_ACTIONS"];
  return env;
}
