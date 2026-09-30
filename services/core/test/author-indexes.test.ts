import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../src/platform/db.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Índices por autor (ADR 0259). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const plan = (sql: string) => withTransaction(t.c.db, async (tx) => {
  // Con tablas de prueba pequeñas el planificador prefiere recorrerlas: se le quita esa opción para ver si hay índice.
  await tx.query(`SET LOCAL enable_seqscan = off`);
  const { rows } = await tx.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`);
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
});

describe("índices por autor", () => {
  it("el cupo de comentarios por minuto no recorre toda la tabla", async () => {
    expect(await plan(`SELECT count(*) FROM social.comments WHERE author_profile_id = '00000000-0000-0000-0000-000000000000' AND created_at > now() - interval '1 minute'`))
      .toContain("comments_author_time_idx");
  });

  it("borrar la cuenta y exportar encuentran reacciones, menciones y compartidos por persona", async () => {
    for (const [table, index] of [["reactions", "reactions_profile_idx"], ["comment_reactions", "comment_reactions_profile_idx"],
      ["post_mentions", "post_mentions_profile_idx"], ["external_shares", "external_shares_profile_idx"]]) {
      expect(await plan(`DELETE FROM social.${table} WHERE profile_id = '00000000-0000-0000-0000-000000000000'`), table).toContain(index);
    }
  });
});
