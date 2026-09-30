import { importPKCS8, SignJWT } from "jose";
import { isRetryableStatus, mapLimit, type PushMessage, type PushResult, type PushSender } from "./types.js";

/** Cuenta de servicio de Firebase (JSON descargado de la consola). */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmConfig {
  account: FcmServiceAccount;
  /** Solo pruebas: sustituye https://fcm.googleapis.com. */
  baseUrl?: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/**
 * FCM HTTP v1 directo (gratis). OAuth 2.0 con JWT de la cuenta de servicio; el token de acceso se reutiliza hasta
 * un minuto antes de caducar. En Android el aviso usa el canal "alerts" y `tag` para agrupar/reemplazar.
 */
export class FcmSender implements PushSender {
  readonly name = "fcm";
  private access: { value: string; until: number } | null = null;

  constructor(private readonly cfg: FcmConfig, private readonly now: () => Date = () => new Date()) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const token = await this.accessToken();
    const base = this.cfg.baseUrl ?? "https://fcm.googleapis.com";
    return mapLimit(messages, 10, async (m) => {
      try {
        const res = await fetch(`${base}/v1/projects/${this.cfg.account.project_id}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ message: FcmSender.message(m) }),
        });
        if (res.ok) return { token: m.token, ok: true, invalidToken: false };
        const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
        const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status ?? `HTTP ${res.status}`;
        return { token: m.token, ok: false, invalidToken: res.status === 404 || code === "UNREGISTERED", retryable: isRetryableStatus(res.status), error: code };
      } catch (e) {
        return { token: m.token, ok: false, invalidToken: false, retryable: true, error: (e as Error).message };
      }
    });
  }

  static message(m: PushMessage): Record<string, unknown> {
    return {
      token: m.token,
      notification: { title: m.title, body: m.body },
      data: { url: m.url, ...m.data },
      android: {
        priority: m.critical ? "HIGH" : "NORMAL",
        collapse_key: m.groupKey,
        ttl: "86400s",
        notification: { channel_id: "alerts", tag: m.groupKey, notification_count: m.badge },
      },
    };
  }

  private async accessToken(): Promise<string> {
    const t = this.now().getTime();
    if (this.access && t < this.access.until) return this.access.value;
    const a = this.cfg.account;
    const aud = a.token_uri ?? "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(a.private_key, "RS256");
    const iat = Math.floor(t / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(a.client_email)
      .setAudience(aud)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await fetch(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new Error(`OAuth FCM: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.access = { value: body.access_token, until: t + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }
}
