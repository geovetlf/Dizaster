import { connect, constants, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { isRetryableStatus, mapLimit, type PushMessage, type PushResult, type PushSender } from "./types.js";

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  /** Contenido del archivo .p8 (PKCS#8) de la clave de autenticación de APNs. */
  privateKeyPem: string;
  bundleId: string;
  /** Solo pruebas: sustituye los hosts de Apple. */
  baseUrls?: { production: string; development: string };
  /** Plazo por petición (ADR 0205). Por defecto 10 s. */
  timeoutMs?: number;
}

const HOSTS = { production: "https://api.push.apple.com", development: "https://api.sandbox.push.apple.com" };
/** Razones de APNs que significan "este token ya no sirve". */
const INVALID = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

/**
 * APNs directo por HTTP/2 con autenticación por token (JWT ES256). Sin SDK ni intermediarios: gratis.
 * Una conexión por entorno, reutilizada; el JWT se renueva cada 50 min (Apple exige entre 20 y 60).
 */
export class ApnsSender implements PushSender {
  readonly name = "apns";
  private jwt: { value: string; at: number } | null = null;
  private readonly sessions = new Map<string, ClientHttp2Session>();

  constructor(private readonly cfg: ApnsConfig, private readonly now: () => Date = () => new Date()) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const auth = await this.token();
    return mapLimit(messages, 10, (m) => this.one(m, auth));
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }

  /** Cuerpo APNs: `thread-id` agrupa en el centro de notificaciones; `url` lo usa la app para abrir el EVENT. */
  static payload(m: PushMessage): Record<string, unknown> {
    return {
      aps: {
        alert: { title: m.title, body: m.body },
        sound: "default",
        badge: m.badge,
        "thread-id": m.groupKey,
        // Solo lo oficial y grave atraviesa "Concentración" (requiere el entitlement time-sensitive, sin coste).
        "interruption-level": m.critical ? "time-sensitive" : "active",
      },
      url: m.url,
      ...m.data,
    };
  }

  private async token(): Promise<string> {
    const t = this.now().getTime();
    if (this.jwt && t - this.jwt.at < 50 * 60_000) return this.jwt.value;
    const key = await importPKCS8(this.cfg.privateKeyPem, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.cfg.keyId })
      .setIssuer(this.cfg.teamId)
      .setIssuedAt(Math.floor(t / 1000))
      .sign(key);
    this.jwt = { value, at: t };
    return value;
  }

  private session(env: "production" | "development"): ClientHttp2Session {
    const url = (this.cfg.baseUrls ?? HOSTS)[env];
    const existing = this.sessions.get(url);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = connect(url);
    s.on("error", () => this.sessions.delete(url));
    s.on("close", () => this.sessions.delete(url));
    this.sessions.set(url, s);
    return s;
  }

  private one(m: PushMessage, auth: string): Promise<PushResult> {
    return new Promise((resolve) => {
      const body = JSON.stringify(ApnsSender.payload(m));
      const req = this.session(m.environment).request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: `/3/device/${m.token}`,
        authorization: `bearer ${auth}`,
        "apns-topic": this.cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": m.critical ? "10" : "5",
        "apns-collapse-id": m.groupKey.slice(0, 64),
        "apns-expiration": String(Math.floor(this.now().getTime() / 1000) + 24 * 3600),
        "content-type": "application/json",
      });
      let status = 0;
      let text = "";
      req.setEncoding("utf8");
      req.on("response", (h) => { status = Number(h[constants.HTTP2_HEADER_STATUS]); });
      req.on("data", (c: string) => { text += c; });
      req.on("end", () => {
        if (status === 200) return resolve({ token: m.token, ok: true, invalidToken: false });
        let reason = `HTTP ${status}`;
        try { reason = (JSON.parse(text) as { reason?: string }).reason ?? reason; } catch { /* cuerpo vacío */ }
        resolve({ token: m.token, ok: false, invalidToken: status === 410 || INVALID.has(reason), retryable: isRetryableStatus(status), error: reason });
      });
      req.on("error", (e) => resolve({ token: m.token, ok: false, invalidToken: false, retryable: true, error: e.message }));
      // Plazo (ADR 0205): APNs que no responde no retiene el envío; se cancela el stream y se reintenta después.
      req.setTimeout(this.cfg.timeoutMs ?? 10_000, () => {
        req.close(constants.NGHTTP2_CANCEL);
        resolve({ token: m.token, ok: false, invalidToken: false, retryable: true, error: "TIMEOUT" });
      });
      req.end(body);
    });
  }
}
