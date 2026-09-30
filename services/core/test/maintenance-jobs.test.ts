import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dailyJobs, hourlyJobs, runJobs } from "../src/maintenance.js";
import { createTestContext, type TestContext } from "./helpers.js";

// ADR 0243: un fallo en una tarea de mantenimiento no salta las demás.
describe("tareas de mantenimiento aisladas", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("si falla la retención de media, las demás tareas diarias corren igual", async () => {
    const media = vi.spyOn(t.c.media, "applyRetention").mockRejectedValue(new Error("S3 caído"));
    const outbox = vi.spyOn(t.c.dispatcher, "purgeProcessed");
    const crashes = vi.spyOn(t.c.crashes, "applyRetention");
    const warned: string[] = [];
    const { failed } = await runJobs(dailyJobs(t.c), () => undefined, (m) => warned.push(m));
    expect(failed).toEqual(["retention.media"]);
    expect(warned).toEqual(["retention.media.failed"]);
    expect(outbox).toHaveBeenCalled();
    expect(crashes).toHaveBeenCalled();
    media.mockRestore();
  });

  it("la generalización de presencia es la primera tarea diaria", () => {
    expect(dailyJobs(t.c)[0]![0]).toBe("retention.presence.generalized");
  });

  it("si falla el ciclo de vida, el archivo y los duplicados siguen", async () => {
    const lifecycle = vi.spyOn(t.c.events, "applyLifecycle").mockRejectedValue(new Error("tiempo agotado"));
    const dup = vi.spyOn(t.c.events, "sweepDuplicates");
    const { failed } = await runJobs(hourlyJobs(t.c), () => undefined, () => undefined);
    expect(failed).toEqual(["events.lifecycle"]);
    expect(dup).toHaveBeenCalled();
    lifecycle.mockRestore();
  });
});
