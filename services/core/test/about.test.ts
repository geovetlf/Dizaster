import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttributionsResponse } from "@dizaster/contracts";
import { createTestContext, type TestContext } from "./helpers.js";

describe("Acerca de / licencias (ADR 0051)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("lista mapa, zonas horarias y fuentes activas sin sesión", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/about/attributions" });
    expect(res.statusCode).toBe(200);
    const body = AttributionsResponse.parse(res.json());
    const map = body.attributions.find((a) => a.kind === "MAP")!;
    expect(map.license).toBe("ODbL 1.0");
    expect(body.attributions.find((a) => a.kind === "TIMEZONE")?.attribution).toContain("OpenStreetMap");
    const sources = body.attributions.filter((a) => a.kind === "SOURCE").map((a) => a.id);
    expect(sources).toContain("usgs-earthquakes");
    expect(res.headers["cache-control"]).toContain("public");
  });
});
