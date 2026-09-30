import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, seedGeoFixtures, submit, type TestContext } from "./helpers.js";

// Cómo ayudar (D-15, ADR 0274): enlaces a organizaciones verificadas; el directorio arranca vacío.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); await seedGeoFixtures(t); });
afterAll(() => t.close());

describe("donaciones de un evento", () => {
  it("devuelve solo las organizaciones del directorio que aplican, sin datos de pago", async () => {
    const u = await createUser(t, "donaciones_rep");
    const eventId = (await submit(t, u, reportBody(u))).body.eventId!;
    const empty = await t.app.inject({ url: `/v1/events/${eventId}/donations` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ organizations: [] });

    const event = (await t.app.inject({ url: `/v1/events/${eventId}` })).json() as { countryCode: string | null; categoryCode: string };
    expect(event.countryCode).toBe("PE");
    (t.c.ref as { donations: unknown }).donations = {
      version: "t", organizations: [{
        id: "cruz-test", name: "Organización de prueba", countries: ["PE"], categories: [], active: true,
        url: "https://cruz-test.example.org/donar", verification: { by: "prueba", at: "2026-09-30", evidence: "test" },
      }],
    };
    const res = (await t.app.inject({ url: `/v1/events/${eventId}/donations` })).json();
    expect(res.organizations).toEqual([{ id: "cruz-test", name: "Organización de prueba", url: "https://cruz-test.example.org/donar" }]);
  });

  it("un evento inexistente da 404", async () => {
    expect((await t.app.inject({ url: "/v1/events/0b8f6a8e-6f0e-4f3e-9d57-8a0b6a0f0c99/donations" })).statusCode).toBe(404);
  });
});
