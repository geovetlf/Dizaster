import type { EventMapResponse } from "@dizaster/contracts";
import { mergeMapTiles, tilesForView } from "@dizaster/geo-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Mapa por teselas z/x/y cacheables (ADR 0078). NO AI REQUIRED.
let t: TestContext;
const ids: string[] = [];
beforeAll(async () => {
  t = await createTestContext();
  for (const [i, p] of [LIMA, offset(LIMA, 3_000, 2_000), offset(LIMA, -4_000, 5_000)].entries()) {
    const u = await createUser(t, `tesela_${i}`);
    ids.push((await submit(t, u, reportBody(u, { category: "fire.structure", pin: p }))).body.eventId!);
  }
  await t.c.dispatcher.drain();
});
afterAll(async () => { await t.close(); });

const tile = (z: number, x: number, y: number, qs = "") => t.app.inject({ url: `/v1/events/tiles/${z}/${x}/${y}${qs}` });

describe("mapa por teselas", () => {
  it("las teselas de una vista, unidas, dan lo mismo que el bbox", async () => {
    const bbox = [-77.06, -12.09, -76.99, -11.99] as const;
    const tiles = tilesForView(bbox, 13);
    const parts: EventMapResponse[] = [];
    for (const tl of tiles) {
      const res = await tile(tl.z, tl.x, tl.y);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toContain("s-maxage=60");
      parts.push(res.json());
    }
    expect(tiles[0]!.z).toBe(13);
    const merged = mergeMapTiles(parts);
    const direct = (await t.app.inject({ url: `/v1/events?bbox=${bbox.join(",")}&zoom=${tiles[0]!.z}` })).json() as EventMapResponse;
    expect(merged.mode).toBe(direct.mode);
    expect(merged.events.map((e) => e.id).sort()).toEqual(direct.events.map((e) => e.id).sort());
    expect(merged.events.map((e) => e.id).sort()).toEqual([...ids].sort());
  });

  it("zoom bajo devuelve clusters; filtros y teselas inválidas", async () => {
    const [low] = tilesForView([-77.2, -12.2, -76.9, -11.9], 4);
    const res = (await tile(low!.z, low!.x, low!.y)).json() as EventMapResponse;
    expect(res.mode).toBe("clusters");
    expect(res.clusters.reduce((a, c) => a + c.count, 0)).toBeGreaterThanOrEqual(3);
    const [hi] = tilesForView([-77.05, -12.05, -77.04, -12.04], 14);
    expect(((await tile(hi!.z, hi!.x, hi!.y, "?categories=natural")).json() as EventMapResponse).events).toHaveLength(0);
    expect((await tile(2, 4, 0)).statusCode).toBe(400);
    expect((await tile(30, 0, 0)).statusCode).toBe(400);
  });
});
