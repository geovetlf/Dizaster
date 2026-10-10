import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ingestionUserAgent, NodeHttpFetcher } from "../src/modules/ingestion/index.js";
import { configWarnings, loadEnv } from "../src/platform/config.js";

// Contacto del cliente de ingesta en el User-Agent (Blueprint §9.3, ADR 0307).
const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(32), FIELD_KEYS: "k:x", PUSH_DRIVER: "live",
  STORAGE_DRIVER: "s3", S3_ENDPOINT: "e", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s" };

describe("contacto del cliente de ingesta", () => {
  it("el User-Agent dice dónde contactar, o 'contacto pendiente' si no hay contacto", () => {
    expect(ingestionUserAgent("ingesta@example.org")).toBe("Dizaster-Ingestion/0.1 (+ingesta@example.org)");
    expect(ingestionUserAgent("")).toBe("Dizaster-Ingestion/0.1 (+contacto pendiente)");
    expect(ingestionUserAgent()).toBe("Dizaster-Ingestion/0.1 (+contacto pendiente)");
  });

  it("acepta un correo o una URL https y rechaza lo demás", () => {
    const env = (v: string) => loadEnv({ ...prod, INGEST_CONTACT: v } as NodeJS.ProcessEnv);
    expect(env("ingesta@example.org").INGEST_CONTACT).toBe("ingesta@example.org");
    expect(env("https://example.org/contacto").INGEST_CONTACT).toBe("https://example.org/contacto");
    expect(env("").INGEST_CONTACT).toBe("");
    for (const bad of ["http://example.org", "no es un contacto", "a@b", "x@y.org) (inyección"]) expect(() => env(bad)).toThrow();
  });

  it("en producción sin contacto arranca, pero config-check lo avisa", () => {
    expect(configWarnings(loadEnv(prod as NodeJS.ProcessEnv))).toHaveLength(1);
    expect(configWarnings(loadEnv({ ...prod, INGEST_CONTACT: "ingesta@example.org" } as NodeJS.ProcessEnv))).toEqual([]);
    expect(configWarnings(loadEnv({ DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(32) } as NodeJS.ProcessEnv))).toEqual([]);
  });

  it("el cliente HTTP envía ese User-Agent a la fuente", async () => {
    let seen: string | undefined;
    const server = createServer((req, res) => { seen = req.headers["user-agent"]; res.end("{}"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const fetcher = new NodeHttpFetcher({ timeoutMs: 2000, maxBytes: 1024, userAgent: ingestionUserAgent("ingesta@example.org") });
      expect((await fetcher.get(`http://127.0.0.1:${port}/feed`, { etag: null, lastModified: null })).status).toBe(200);
      expect(seen).toBe("Dizaster-Ingestion/0.1 (+ingesta@example.org)");
    } finally {
      server.close();
    }
  });
});
