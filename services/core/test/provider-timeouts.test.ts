import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createServer as createH2Server, type Http2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApnsSender, FcmSender, GuardedSender, PushGateway, type PushMessage, type PushResult, type PushSender } from "../src/modules/alert/index.js";
import { S3Storage } from "../src/modules/media/index.js";
import { CircuitBreaker } from "../src/platform/breaker.js";

// Plazos y cortocircuito para proveedores externos (ADR 0205): uno que no responde no retiene los avisos urgentes.
const msg = (over: Partial<PushMessage> = {}): PushMessage => ({
  provider: "APNS", token: "tok", environment: "production", title: "t", body: "b", url: "dizaster://alerts",
  groupKey: "g", badge: 1, critical: true, data: {}, ...over,
});

describe("proveedores que no responden", () => {
  let h2: Http2Server;
  let http: Server;
  let h2Base: string;
  let httpBase: string;
  beforeAll(async () => {
    h2 = createH2Server();
    h2.on("stream", () => { /* nunca responde */ });
    http = createServer(() => { /* nunca responde */ });
    await new Promise<void>((r) => h2.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    h2Base = `http://127.0.0.1:${(h2.address() as AddressInfo).port}`;
    httpBase = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
    await new Promise<void>((r) => h2.close(() => r()));
  });

  it("APNs: vence el plazo y queda como reintentable", async () => {
    const privateKeyPem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const sender = new ApnsSender({ teamId: "T", keyId: "K", privateKeyPem, bundleId: "app.dizaster.mobile", baseUrls: { production: h2Base, development: h2Base }, timeoutMs: 200 });
    const t0 = Date.now();
    const [r] = await sender.send([msg()]);
    sender.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ ok: false, retryable: true, error: "TIMEOUT" });
  });

  it("FCM: vence el plazo del token OAuth y el gateway lo devuelve como reintentable", async () => {
    const private_key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fcm = new FcmSender({ account: { project_id: "p", client_email: "x@p.iam", private_key, token_uri: `${httpBase}/token` }, baseUrl: httpBase, timeoutMs: 200 });
    const t0 = Date.now();
    const [r] = await new PushGateway({ APNS: null, FCM: fcm }).send([msg({ provider: "FCM" })]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it("S3: una petición colgada falla dentro del plazo", async () => {
    const s3 = new S3Storage({ endpoint: httpBase, region: "auto", bucket: "b", accessKeyId: "a", secretAccessKey: "s", forcePathStyle: true, publicBaseUrl: null, timeoutMs: 200 });
    const t0 = Date.now();
    await expect(s3.get("x")).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("cortocircuito", () => {
  it("se abre tras N fallos, espera, prueba una vez y se cierra si va bien", () => {
    let now = 0;
    const opened: number[] = [];
    let closed = 0;
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, maxCooldownMs: 3000, now: () => now, onOpen: (i) => opened.push(i.cooldownMs), onClose: () => { closed += 1; } });
    for (let i = 0; i < 3; i++) { expect(b.allow()).toBe(true); b.failure(); }
    expect(b.state).toBe("open");
    expect(b.allow()).toBe(false);
    now = 1000;
    expect(b.allow()).toBe(true);   // llamada de prueba
    expect(b.allow()).toBe(false);  // solo una a la vez
    b.failure();                    // falla: vuelve a abrirse con el doble de espera
    expect(opened).toEqual([1000, 2000]);
    now = 2500;
    expect(b.allow()).toBe(false);
    now = 3000;
    expect(b.allow()).toBe(true);
    b.success();
    expect(b.state).toBe("closed");
    expect(closed).toBe(1);
  });

  it("con el circuito abierto no se llama al proveedor y los avisos quedan para reintentar", async () => {
    let calls = 0;
    const failing: PushSender = { name: "x", send: async (ms) => { calls += 1; return ms.map((m): PushResult => ({ token: m.token, ok: false, invalidToken: false, retryable: true, error: "HTTP 503" })); } };
    const guarded = new GuardedSender(failing, new CircuitBreaker({ threshold: 2, cooldownMs: 60_000, maxCooldownMs: 60_000 }));
    await guarded.send([msg()]);
    await guarded.send([msg()]);
    const [r] = await guarded.send([msg()]);
    expect(calls).toBe(2);
    expect(r).toMatchObject({ ok: false, retryable: true, error: "CIRCUIT_OPEN" });
  });

  it("un token inválido no cuenta como caída del proveedor", async () => {
    let calls = 0;
    const invalid: PushSender = { name: "x", send: async (ms) => { calls += 1; return ms.map((m): PushResult => ({ token: m.token, ok: false, invalidToken: true, error: "Unregistered" })); } };
    const guarded = new GuardedSender(invalid, new CircuitBreaker({ threshold: 1, cooldownMs: 60_000, maxCooldownMs: 60_000 }));
    await guarded.send([msg()]);
    await guarded.send([msg()]);
    expect(calls).toBe(2);
  });
});
