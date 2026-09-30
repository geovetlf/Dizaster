import { generateKeyPairSync } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createH2Server, type Http2Server, type IncomingHttpHeaders } from "node:http2";
import type { AddressInfo } from "node:net";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApnsSender, FcmSender, PushGateway, type PushMessage, type PushSender } from "../src/modules/alert/index.js";

const msg = (over: Partial<PushMessage> = {}): PushMessage => ({
  provider: "APNS", token: "tok-ok", environment: "production", title: "Inundación en Miraflores, Lima",
  body: "Corroborado por la comunidad · severidad 3/5", url: "dizaster://event/abc", groupKey: "event-abc", badge: 2,
  critical: false, data: { alertId: "a1" }, ...over,
});

const pem = (type: "ec" | "rsa") =>
  type === "ec"
    ? generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("APNs (HTTP/2 contra un servidor local)", () => {
  let server: Http2Server;
  let base: string;
  const seen: { headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createH2Server();
    server.on("stream", (stream, headers) => {
      let raw = "";
      stream.setEncoding("utf8");
      stream.on("data", (c: string) => { raw += c; });
      stream.on("end", () => {
        seen.push({ headers, body: JSON.parse(raw) as Record<string, unknown> });
        const token = String(headers[":path"]).split("/").pop();
        if (token === "tok-ok") { stream.respond({ ":status": 200 }); stream.end(); return; }
        if (token === "tok-gone") { stream.respond({ ":status": 410 }); stream.end(JSON.stringify({ reason: "Unregistered" })); return; }
        stream.respond({ ":status": 400 });
        stream.end(JSON.stringify({ reason: token === "tok-bad" ? "BadDeviceToken" : "PayloadTooLarge" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("firma con ES256, manda cabeceras y payload correctos y detecta tokens muertos", async () => {
    const sender = new ApnsSender({ teamId: "TEAM123", keyId: "KEY456", privateKeyPem: pem("ec"), bundleId: "app.dizaster.mobile", baseUrls: { production: base, development: base } });
    try {
      const results = await sender.send([
        msg(), msg({ token: "tok-gone" }), msg({ token: "tok-bad" }), msg({ token: "tok-other", critical: true }),
      ]);
      expect(results.map((r) => [r.token, r.ok, r.invalidToken])).toEqual([
        ["tok-ok", true, false], ["tok-gone", false, true], ["tok-bad", false, true], ["tok-other", false, false],
      ]);
      expect(results[3]!.error).toBe("PayloadTooLarge");
      const first = seen.find((s) => String(s.headers[":path"]).endsWith("tok-ok"))!;
      expect(first.headers).toMatchObject({ "apns-topic": "app.dizaster.mobile", "apns-push-type": "alert", "apns-priority": "5", "apns-collapse-id": "event-abc" });
      const auth = String(first.headers["authorization"]).replace(/^bearer /, "");
      expect(decodeProtectedHeader(auth)).toMatchObject({ alg: "ES256", kid: "KEY456" });
      expect(decodeJwt(auth).iss).toBe("TEAM123");
      expect(first.body).toMatchObject({ url: "dizaster://event/abc", alertId: "a1", aps: { alert: { title: "Inundación en Miraflores, Lima" }, badge: 2, "thread-id": "event-abc", "interruption-level": "active" } });
      const critical = seen.find((s) => String(s.headers[":path"]).endsWith("tok-other"))!;
      expect(critical.headers["apns-priority"]).toBe("10");
      expect(critical.body).toMatchObject({ aps: { "interruption-level": "time-sensitive" } });
    } finally {
      sender.close();
    }
  });

  it("reutiliza el JWT durante 50 minutos", async () => {
    let now = new Date("2026-09-29T00:00:00Z");
    const sender = new ApnsSender({ teamId: "T", keyId: "K", privateKeyPem: pem("ec"), bundleId: "b", baseUrls: { production: base, development: base } }, () => now);
    try {
      seen.length = 0;
      await sender.send([msg()]);
      now = new Date(now.getTime() + 49 * 60_000);
      await sender.send([msg()]);
      now = new Date(now.getTime() + 2 * 60_000);
      await sender.send([msg()]);
      const tokens = seen.map((s) => s.headers["authorization"]);
      expect(tokens[0]).toBe(tokens[1]);
      expect(tokens[2]).not.toBe(tokens[1]);
    } finally {
      sender.close();
    }
  });
});

describe("FCM HTTP v1 (contra un servidor local)", () => {
  let server: Server;
  let base: string;
  let oauthCalls = 0;
  const sent: { auth: string | undefined; body: { message: Record<string, unknown> } }[] = [];

  const readBody = (req: IncomingMessage) => new Promise<string>((r) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => r(s)); });

  beforeAll(async () => {
    server = createHttpServer(async (req, res) => {
      const body = await readBody(req);
      if (req.url === "/token") {
        oauthCalls++;
        const assertion = new URLSearchParams(body).get("assertion")!;
        const claims = decodeJwt(assertion);
        const ok = claims.iss === "push@dizaster-test.iam.gserviceaccount.com" && claims["scope"] === "https://www.googleapis.com/auth/firebase.messaging";
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: `at-${oauthCalls}`, expires_in: 3600 }));
        return;
      }
      const parsed = JSON.parse(body) as { message: { token: string } & Record<string, unknown> };
      sent.push({ auth: req.headers.authorization, body: parsed });
      expect(req.url).toBe("/v1/projects/dizaster-test/messages:send");
      const token = parsed.message.token;
      if (token === "tok-ok") { res.writeHead(200); res.end("{}"); return; }
      if (token === "tok-gone") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }));
        return;
      }
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", details: [{ errorCode: "QUOTA_EXCEEDED" }] } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("obtiene y reutiliza el token OAuth, manda el mensaje v1 y detecta tokens muertos", async () => {
    const sender = new FcmSender({
      account: { project_id: "dizaster-test", client_email: "push@dizaster-test.iam.gserviceaccount.com", private_key: pem("rsa"), token_uri: `${base}/token` },
      baseUrl: base,
    });
    const r1 = await sender.send([msg({ provider: "FCM" }), msg({ provider: "FCM", token: "tok-gone" }), msg({ provider: "FCM", token: "tok-busy", critical: true })]);
    expect(r1.map((r) => [r.ok, r.invalidToken, r.error ?? null])).toEqual([[true, false, null], [false, true, "UNREGISTERED"], [false, false, "QUOTA_EXCEEDED"]]);
    await sender.send([msg({ provider: "FCM" })]);
    expect(oauthCalls).toBe(1);
    expect(sent.every((s) => s.auth === "Bearer at-1")).toBe(true);
    expect(sent[0]!.body.message).toMatchObject({
      notification: { title: "Inundación en Miraflores, Lima" },
      data: { url: "dizaster://event/abc", alertId: "a1" },
      android: { priority: "NORMAL", collapse_key: "event-abc", notification: { channel_id: "alerts", tag: "event-abc", notification_count: 2 } },
    });
    expect(sent.find((s) => s.body.message["token"] === "tok-busy")!.body.message).toMatchObject({ android: { priority: "HIGH", notification: { channel_id: "official_critical" } } });
  });
});

describe("PushGateway", () => {
  it("reparte por proveedor, conserva el orden y aísla fallos", async () => {
    const ok: PushSender = { name: "ok", send: async (ms) => ms.map((m) => ({ token: m.token, ok: true, invalidToken: false })) };
    const boom: PushSender = { name: "boom", send: async () => { throw new Error("red caída"); } };
    const input = [msg({ provider: "FCM", token: "f1" }), msg({ token: "a1" }), msg({ provider: "FCM", token: "f2" })];

    const r1 = await new PushGateway({ APNS: ok, FCM: boom }).send(input);
    expect(r1.map((r) => [r.token, r.ok, r.error ?? null])).toEqual([["f1", false, "red caída"], ["a1", true, null], ["f2", false, "red caída"]]);

    const r2 = await new PushGateway({ APNS: null, FCM: ok }).send(input);
    expect(r2.map((r) => [r.token, r.ok])).toEqual([["f1", true], ["a1", false], ["f2", true]]);
    expect(r2[1]!.error).toBe("APNS no configurado");
  });
});
