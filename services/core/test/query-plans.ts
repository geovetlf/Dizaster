import pg from "pg";
import type { TestContext, TestUser } from "./helpers.js";

/**
 * Herramientas de las pruebas de planes con volumen (ADR 0309, 0310). Con tablas casi vacías PostgreSQL siempre
 * recorre la tabla entera, así que un índice que falta no se nota hasta producción: estas pruebas clonan filas reales
 * en volumen y piden el plan de cada SELECT que lanza una petición.
 */

/**
 * Clona filas plantilla con jsonb_populate_record: copia todas las columnas, incluso las que agreguen migraciones
 * futuras. Las columnas generadas se calculan solas y no se insertan.
 */
export async function clone(db: pg.PoolClient, table: string, overrides: string, from: string, values: unknown[]): Promise<void> {
  const [schema, name] = table.split(".");
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [schema, name]);
  const cols = rows.map((r) => `"${r.column_name}"`).join(", ");
  await db.query(`INSERT INTO ${table} (${cols})
    SELECT ${rows.map((r) => `x."${r.column_name}"`).join(", ")}
    FROM ${from}, LATERAL jsonb_populate_record(NULL::${table}, to_jsonb(s) || jsonb_build_object(${overrides})) x`, values);
}

interface PlanNode { "Node Type": string; "Relation Name"?: string; Schema?: string; Plans?: PlanNode[] }
function seqScans(node: PlanNode, big: ReadonlySet<string>, out: string[] = []): string[] {
  const rel = node["Relation Name"] ? `${node.Schema}.${node["Relation Name"]}` : null;
  if (node["Node Type"] === "Seq Scan" && rel && big.has(rel)) out.push(rel);
  for (const child of node.Plans ?? []) seqScans(child, big, out);
  return out;
}

/** Ejecuta `action`, guarda cada consulta que lee filas y devuelve las tablas grandes (`esquema.tabla`) que alguna recorre entera. */
export async function scansDuring(t: TestContext, action: () => Promise<unknown>, big: ReadonlySet<string>): Promise<{ queries: number; scans: string[] }> {
  const seen: { text: string; values: unknown[] }[] = [];
  const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
  const original = proto.query;
  proto.query = function (this: unknown, ...a: unknown[]) {
    const [text, values] = a;
    // Lecturas y escrituras que buscan filas; un INSERT ... VALUES no recorre nada. EXPLAIN sin ANALYZE no ejecuta.
    if (typeof text === "string" && /^\s*(SELECT|WITH|UPDATE|DELETE|INSERT\b[\s\S]*\bSELECT\b)/i.test(text)) seen.push({ text, values: Array.isArray(values) ? values : [] });
    return original.apply(this, a);
  };
  try {
    await action();
  } finally {
    proto.query = original;
  }
  const scans: string[] = [];
  for (const q of seen) {
    const { rows } = await t.c.db.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(`EXPLAIN (VERBOSE, FORMAT JSON) ${q.text}`, q.values);
    for (const rel of seqScans(rows[0]!["QUERY PLAN"][0]!.Plan, big)) scans.push(`${rel} ← ${q.text.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  return { queries: seen.length, scans: [...new Set(scans)] };
}

/** Lo mismo para una petición GET: además devuelve su estado HTTP. */
export async function scansOf(
  t: TestContext, url: string, big: ReadonlySet<string>, user?: TestUser,
): Promise<{ status: number; queries: number; scans: string[] }> {
  let status = 0;
  const r = await scansDuring(t, async () => {
    status = (await t.app.inject({ url, ...(user ? { headers: { authorization: `Bearer ${user.token}` } } : {}) })).statusCode;
  }, big);
  return { status, ...r };
}
