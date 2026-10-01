import { describe, expect, it } from "vitest";
import { S3Storage } from "../src/modules/media/index.js";
import { loadEnv } from "../src/platform/config.js";
import { makeJpeg } from "./media-fixtures.js";

/**
 * Prueba del cliente S3 (firma SigV4) contra un servidor compatible real. Se activa con S3_TEST_ENDPOINT
 * (en CI: moto; en local: MinIO, R2 de pruebas, etc.). Sin la variable, se omite.
 */
const endpoint = process.env["S3_TEST_ENDPOINT"];

describe("firma SigV4 (vector oficial de AWS)", () => {
  it("reproduce la URL prefirmada del ejemplo de la documentación de S3", () => {
    // Ejemplo "Authenticating Requests: Using Query Parameters" de la documentación de Amazon S3.
    const s3 = new S3Storage(
      {
        endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "examplebucket",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        forcePathStyle: false, publicBaseUrl: null,
      },
      () => new Date("2013-05-24T00:00:00Z"),
    );
    const url = new URL(s3.presignGet("test.txt", 86400));
    expect(url.host).toBe("examplebucket.s3.amazonaws.com");
    expect(url.searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("la subida firma tamaño y tipo: el cliente debe enviarlos exactos", async () => {
    const s3 = new S3Storage({
      endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "b", accessKeyId: "k", secretAccessKey: "s",
      forcePathStyle: false, publicBaseUrl: "https://media.example.org",
    });
    const up = await s3.presignPut({ key: "originals/x", mime: "image/jpeg", sizeBytes: 123, ttlSeconds: 60 });
    expect(new URL(up.url).searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(up.headers).toEqual({ "content-length": "123", "content-type": "image/jpeg" });
    expect(s3.publicUrl("public/a b.jpg")).toBe("https://media.example.org/public/a%20b.jpg");
  });
});

describe("Cache-Control de la media pública (ADR 0286)", () => {
  const base = { NODE_ENV: "test", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(40) };
  it("una hora por defecto y solo valores con forma de Cache-Control", () => {
    expect(loadEnv(base).MEDIA_PUBLIC_CACHE_CONTROL).toBe("public, max-age=3600");
    expect(loadEnv({ ...base, MEDIA_PUBLIC_CACHE_CONTROL: "public, max-age=600, immutable" }).MEDIA_PUBLIC_CACHE_CONTROL).toBe("public, max-age=600, immutable");
    expect(() => loadEnv({ ...base, MEDIA_PUBLIC_CACHE_CONTROL: "public\r\nx-evil: 1" })).toThrow();
  });
});

describe.skipIf(!endpoint)("S3Storage contra un servidor compatible", () => {
  const bucket = `dizaster-test-${Date.now()}`;
  const s3 = new S3Storage({
    endpoint: endpoint!, region: "us-east-1", bucket, accessKeyId: process.env["S3_TEST_ACCESS_KEY_ID"] ?? "test",
    secretAccessKey: process.env["S3_TEST_SECRET_ACCESS_KEY"] ?? "test", forcePathStyle: true, publicBaseUrl: null,
  });

  it("crea el bucket de prueba", async () => {
    // Creación con la misma firma (PUT sobre la raíz del bucket).
    const res = await (s3 as unknown as { request(m: string, k: string): Promise<Response> }).request("PUT", "");
    expect([200, 409]).toContain(res.status);
  });

  it("subida con URL firmada desde el dispositivo y lectura en el servidor", async () => {
    const file = makeJpeg();
    const up = await s3.presignPut({ key: "originals/t/a", mime: "image/jpeg", sizeBytes: file.length, ttlSeconds: 300 });
    const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: file });
    expect(put.status).toBe(200);
    expect(await s3.stat("originals/t/a")).toEqual({ size: file.length, contentType: "image/jpeg" });
    expect(Buffer.from(await s3.get("originals/t/a")).equals(file)).toBe(true);
  });

  it("put, stat, delete desde el servidor", async () => {
    await s3.put("public/x.jpg", makeJpeg(), "image/jpeg");
    expect((await s3.stat("public/x.jpg"))?.contentType).toBe("image/jpeg");
    await s3.delete("public/x.jpg");
    expect(await s3.stat("public/x.jpg")).toBeNull();
    expect(s3.publicUrl("public/x.jpg")).toContain("X-Amz-Signature=");
  });

  it("guarda el Cache-Control firmado con el objeto (ADR 0286)", async () => {
    await s3.put("public/c.jpg", makeJpeg(), "image/jpeg", { cacheControl: "public, max-age=3600" });
    const head = await (s3 as unknown as { request(m: string, k: string): Promise<Response> }).request("HEAD", "public/c.jpg");
    expect(head.headers.get("cache-control")).toBe("public, max-age=3600");
    await s3.delete("public/c.jpg");
  });
});
