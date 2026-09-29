import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../src/http/app.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Cabeceras de seguridad (ADR 0114).
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("cabeceras de seguridad", () => {
  it("van en respuestas correctas, errores y rutas inexistentes", async () => {
    for (const url of ["/health", "/v1/me", "/v1/no-existe", "/v1/events/no-es-uuid"]) {
      const res = await t.app.inject({ url });
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers[k], `${url} ${k}`).toBe(v);
    }
  });
});
