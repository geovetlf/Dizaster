import { matchesAny } from "./glob.js";
import type { DocRule } from "./policy.js";

/**
 * Documentation Updater (Blueprint §20.20 de la instrucción): comprueba que un cambio de cierto tipo venga con su
 * documentación. No escribe documentación ni la toma como verdad: el código y las pruebas mandan.
 */
export function checkDocs(paths: string[], rules: DocRule[]): string[] {
  return rules
    .filter((r) => paths.some((p) => matchesAny(p, r.when)) && !paths.some((p) => matchesAny(p, r.require)))
    .map((r) => r.message);
}
