import Fastify from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { logPath, requestLogOptions } from "../src/http/log.js";

// Los logs de peticiones no guardan coordenadas del query string ni la IP del cliente (ADR 0204).
describe("logs de peticiones", () => {
  it("quita el query string", () => {
    expect(logPath("/v1/events/nearby?lat=-12.046374&lng=-77.042793")).toBe("/v1/events/nearby?[REDACTED]");
    expect(logPath("/v1/events/abc")).toBe("/v1/events/abc");
  });

  it("una petición real no deja coordenadas ni IP en el log", async () => {
    let out = "";
    const stream = new Writable({ write(chunk, _enc, cb) { out += String(chunk); cb(); } });
    const app = Fastify({ logger: { ...requestLogOptions(), stream } });
    app.get("/v1/events/nearby", async () => ({ ok: true }));
    await app.inject({ url: "/v1/events/nearby?lat=-12.046374&lng=-77.042793", remoteAddress: "203.0.113.77" });
    await app.close();
    expect(out).toContain("/v1/events/nearby?[REDACTED]");
    expect(out).not.toContain("12.046374");
    expect(out).not.toContain("77.042793");
    expect(out).not.toContain("203.0.113.77");
  });
});
