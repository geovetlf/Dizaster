import type { RiskClass } from "./policy.js";

export interface MigrationFinding { file: string; class: RiskClass; message: string }

/** Quita comentarios `--` y `/* *\/` para que un comentario que dice "DROP TABLE" no cuente. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|SCHEMA|DATABASE|EXTENSION)\b/i, "borra una tabla, esquema, base o extensión"],
  [/\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i, "borra una columna"],
  [/\bALTER\s+TABLE\b[^;]*\bRENAME\b/i, "renombra (rompe la versión anterior del código)"],
  [/\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, "cambia el tipo de una columna"],
];
const DATA_LOSS = /\b(TRUNCATE(?:\s+TABLE)?|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi;

/**
 * Revisa las migraciones de un cambio (Blueprint §20.15, ADR 0265). Las migraciones son hacia adelante y deben poder
 * convivir con la versión anterior del código (expand/contract): lo destructivo nunca se aplica solo.
 * - Editar o borrar una migración ya existente → blocked (ya se aplicó en algún entorno).
 * - DROP de tabla/columna, RENAME, cambio de tipo, TRUNCATE/DELETE de datos no derivados → blocked.
 * - Cualquier migración nueva → critical (toca la base).
 */
export function checkMigrations(
  changes: { path: string; status: "A" | "M" | "D" | "R" }[],
  readFile: (path: string) => string,
  opts: { dir: string; derivedTables: string[] },
): MigrationFinding[] {
  const out: MigrationFinding[] = [];
  const derived = new Set(opts.derivedTables.map((t) => t.toLowerCase()));
  for (const c of changes) {
    if (!c.path.startsWith(`${opts.dir}/`) || !c.path.endsWith(".sql")) continue;
    if (c.status !== "A") {
      out.push({ file: c.path, class: "blocked", message: "una migración existente no se edita, renombra ni borra: se añade otra" });
      continue;
    }
    const sql = stripComments(readFile(c.path));
    out.push({ file: c.path, class: "critical", message: "migración nueva: cambia la base de datos" });
    for (const [re, what] of DESTRUCTIVE) if (re.test(sql)) out.push({ file: c.path, class: "blocked", message: `destructiva: ${what}` });
    for (const m of sql.matchAll(DATA_LOSS)) {
      if (!derived.has(m[2]!.toLowerCase())) out.push({ file: c.path, class: "blocked", message: `borra datos de ${m[2]} (no es una tabla derivada)` });
    }
  }
  return out;
}
