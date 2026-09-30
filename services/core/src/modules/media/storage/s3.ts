import { createHash, createHmac } from "node:crypto";
import type { UploadInstruction } from "@dizaster/contracts";
import type { StorageProvider } from "./types.js";

export interface S3Config {
  endpoint: string; // p. ej. https://<cuenta>.r2.cloudflarestorage.com o https://s3.<región>.amazonaws.com
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Base pública (CDN) para variantes públicas. Sin ella se sirven con URL firmada de lectura. */
  publicBaseUrl: string | null;
  /** Plazo por petición (ADR 0205). Por defecto 120 s: cubre un video de 60 MB con una red lenta. */
  timeoutMs?: number;
}

/**
 * Cliente mínimo compatible con S3 (firma AWS SigV4) sin SDK: presign de subida, HEAD, GET, PUT y DELETE.
 * Funciona con AWS S3, Cloudflare R2, Backblaze B2, MinIO y equivalentes.
 */
export class S3Storage implements StorageProvider {
  readonly id = "s3";
  constructor(private readonly c: S3Config, private readonly now: () => Date = () => new Date()) {}

  async presignPut(p: { key: string; mime: string; sizeBytes: number; ttlSeconds: number }): Promise<UploadInstruction> {
    const headers = { "content-length": String(p.sizeBytes), "content-type": p.mime };
    const url = this.presign("PUT", p.key, p.ttlSeconds, headers);
    return { method: "PUT", url, headers };
  }

  /** URL firmada de lectura (para buckets privados sin CDN). */
  presignGet(key: string, ttlSeconds: number): string {
    return this.presign("GET", key, ttlSeconds, {});
  }

  async stat(key: string) {
    const res = await this.request("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 HEAD ${res.status}`);
    return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.request("GET", key);
    if (!res.ok) throw new Error(`S3 GET ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    const res = await this.request("PUT", key, data, { "content-type": mime });
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${await res.text()}`);
  }

  async delete(key: string): Promise<void> {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${res.status}`);
  }

  publicUrl(key: string): string {
    return this.c.publicBaseUrl ? `${this.c.publicBaseUrl.replace(/\/$/, "")}/${encodePath(key)}` : this.presignGet(key, 3600);
  }

  // ───────────── SigV4 ─────────────

  private target(key: string): { url: URL; path: string } {
    const base = new URL(this.c.endpoint);
    const path = this.c.forcePathStyle ? `/${this.c.bucket}/${encodePath(key)}` : `/${encodePath(key)}`;
    const host = this.c.forcePathStyle ? base.host : `${this.c.bucket}.${base.host}`;
    return { url: new URL(`${base.protocol}//${host}${path}`), path };
  }

  private presign(method: string, key: string, ttlSeconds: number, headers: Record<string, string>): string {
    const { url, path } = this.target(key);
    const { amzDate, scope } = this.dates();
    const all = { ...lower(headers), host: url.host };
    const signedHeaders = Object.keys(all).sort().join(";");
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.c.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(ttlSeconds),
      "X-Amz-SignedHeaders": signedHeaders,
    };
    const canonicalQuery = canonicalQueryString(query);
    const signature = this.signature(method, path, canonicalQuery, all, signedHeaders, "UNSIGNED-PAYLOAD", amzDate, scope);
    return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private async request(method: string, key: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<Response> {
    const { url, path } = this.target(key);
    const { amzDate, scope } = this.dates();
    const payloadHash = createHash("sha256").update(body ?? new Uint8Array()).digest("hex");
    const headers: Record<string, string> = { ...lower(extra), host: url.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const signature = this.signature(method, path, "", headers, signedHeaders, payloadHash, amzDate, scope);
    const { host: _host, ...sendHeaders } = headers;
    return fetch(url, {
      method,
      headers: {
        ...sendHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      ...(body ? { body: Buffer.from(body.buffer, body.byteOffset, body.byteLength) } : {}),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 120_000),
    });
  }

  private signature(
    method: string, path: string, query: string, headers: Record<string, string>, signedHeaders: string,
    payloadHash: string, amzDate: string, scope: string,
  ): string {
    const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]!.trim()}\n`).join("");
    const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const [date] = scope.split("/");
    const kDate = hmac(`AWS4${this.c.secretAccessKey}`, date!);
    const kSigning = hmac(hmac(hmac(kDate, this.c.region), "s3"), "aws4_request");
    return createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  }

  private dates() {
    const amzDate = this.now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return { amzDate, scope: `${amzDate.slice(0, 8)}/${this.c.region}/s3/aws4_request` };
  }
}

const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (key: string) => key.split("/").map(rfc3986).join("/");
const canonicalQueryString = (q: Record<string, string>) =>
  Object.keys(q).sort().map((k) => `${rfc3986(k)}=${rfc3986(q[k]!)}`).join("&");
const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
