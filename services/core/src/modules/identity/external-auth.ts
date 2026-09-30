import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Clock } from "../../platform/clock.js";
import { withTransaction, type Db } from "../../platform/db.js";
import type { EmailSender } from "../../platform/email.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import type { Lang } from "@dizaster/contracts";
import type { IdentityProviderVerifier, IdentityService, Session } from "./index.js";

/** Correo con el código en el idioma de la app (ADR 0279). Texto de sistema: nunca lleva datos de la persona. */
const CODE_EMAIL: Record<Lang, (code: string, minutes: number) => { subject: string; text: string }> = {
  es: (c, m) => ({ subject: `Tu código de Dizaster: ${c}`, text: `Tu código para entrar en Dizaster es ${c}. Vence en ${m} minutos. Si no lo pediste, ignora este correo.` }),
  en: (c, m) => ({ subject: `Your Dizaster code: ${c}`, text: `Your code to sign in to Dizaster is ${c}. It expires in ${m} minutes. If you didn't request it, ignore this email.` }),
  pt: (c, m) => ({ subject: `Seu código do Dizaster: ${c}`, text: `Seu código para entrar no Dizaster é ${c}. Ele vence em ${m} minutos. Se você não o pediu, ignore este e-mail.` }),
  fr: (c, m) => ({ subject: `Votre code Dizaster : ${c}`, text: `Votre code pour vous connecter à Dizaster est ${c}. Il expire dans ${m} minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.` }),
};

/**
 * ID tokens de Apple y Google (OIDC, §5.1, D-11, ADR 0170). Implementación propia con `jose`: sin costo por usuario.
 * Se verifica firma (claves públicas del proveedor), emisor, audiencia (los client id de la app, de configuración) y
 * vigencia. Sin audiencias configuradas el proveedor está apagado. NO AI REQUIRED.
 */
export class OidcIdTokenVerifier implements IdentityProviderVerifier {
  constructor(
    readonly provider: "APPLE" | "GOOGLE",
    private readonly issuers: string[],
    private readonly audiences: string[],
    private readonly keys: JWTVerifyGetKey,
  ) {}

  get enabled(): boolean { return this.audiences.length > 0; }

  async verify(idToken: string): Promise<{ subject: string; email?: string }> {
    if (!this.enabled) throw new DomainError("AUTH_PROVIDER_DISABLED", `Inicio de sesión con ${this.provider} no configurado`, 503);
    try {
      const { payload } = await jwtVerify(idToken, this.keys, { issuer: this.issuers, audience: this.audiences, algorithms: ["RS256", "ES256"], clockTolerance: 60 });
      if (typeof payload.sub !== "string" || !payload.sub) throw new Error("sin sub");
      const verified = payload["email_verified"] === true || payload["email_verified"] === "true";
      return { subject: payload.sub, ...(typeof payload["email"] === "string" && verified ? { email: payload["email"] } : {}) };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError("INVALID_CREDENTIAL", "Credencial de inicio de sesión inválida", 401);
    }
  }
}

export const APPLE_ISSUERS = ["https://appleid.apple.com"];
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Claves públicas oficiales; solo se descargan cuando alguien inicia sesión con ese proveedor (y se cachean). */
export const appleKeys = (): JWTVerifyGetKey => createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
export const googleKeys = (): JWTVerifyGetKey => createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const EMAIL_CODE_TTL_MINUTES = 10;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_STARTS_PER_HOUR = 5;
export const EMAIL_STARTS_PER_IP_HOUR = 20;

/** Normaliza el correo para compararlo (sin tocar puntos ni "+", que son parte de la dirección). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Apple, Google y correo con código (ADR 0170). El correo nunca se guarda: la identidad EMAIL usa como `subject` un
 * HMAC del correo normalizado, y los códigos solo existen como hash. Respuesta idéntica exista o no la cuenta.
 */
export class ExternalAuthService {
  private readonly secret: Buffer;
  constructor(
    private readonly db: Db,
    private readonly identity: IdentityService,
    private readonly clock: Clock,
    private readonly oidc: { apple: OidcIdTokenVerifier; google: OidcIdTokenVerifier },
    private readonly email: EmailSender,
    jwtSecret: string,
  ) {
    this.secret = createHmac("sha256", jwtSecret).update("email-identity:v1").digest();
  }

  providers(): { apple: boolean; google: boolean; email: boolean } {
    return { apple: this.oidc.apple.enabled, google: this.oidc.google.enabled, email: this.email.id !== "none" };
  }

  emailKey(email: string): string {
    return createHmac("sha256", this.secret).update(normalizeEmail(email)).digest("base64url");
  }
  private codeHash(challengeId: string, code: string): string {
    return createHmac("sha256", this.secret).update(`${challengeId}:${code}`).digest("hex");
  }
  private ipKey(ip: string | null): string | null {
    return ip ? createHash("sha256").update(`${this.secret.toString("hex")}:${ip}`).digest("base64url").slice(0, 22) : null;
  }

  async signInWithIdToken(provider: "APPLE" | "GOOGLE", idToken: string): Promise<Session> {
    const verifier = provider === "APPLE" ? this.oidc.apple : this.oidc.google;
    const { subject } = await verifier.verify(idToken);
    // El handle inicial nunca sale del correo ni del nombre: se elige después en el perfil.
    return this.identity.signIn(provider, subject, "usuario");
  }

  /** Envía un código de 6 dígitos. Límites por correo y por IP; siempre la misma respuesta. */
  async startEmail(email: string, ip: string | null, lang: Lang = "es"): Promise<void> {
    if (this.email.id === "none") throw new DomainError("EMAIL_NOT_CONFIGURED", "El inicio de sesión por correo aún no está disponible", 503);
    const key = this.emailKey(email);
    const ipKey = this.ipKey(ip);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const id = newId();
    await withTransaction(this.db, async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('email-start:' || $1))`, [key]);
      const counts = (await tx.query<{ by_email: number; by_ip: number }>(
        `SELECT count(*) FILTER (WHERE email_key = $1)::int AS by_email, count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_key = $2)::int AS by_ip
           FROM identity.email_challenges WHERE created_at > $3::timestamptz - interval '1 hour' AND (email_key = $1 OR ip_key = $2)`,
        [key, ipKey, this.clock.now()],
      )).rows[0]!;
      if (counts.by_email >= EMAIL_STARTS_PER_HOUR || counts.by_ip >= EMAIL_STARTS_PER_IP_HOUR) {
        throw new DomainError("RATE_LIMITED", "Demasiados códigos pedidos. Espera un rato.", 429);
      }
      // Pedir un código nuevo anula los anteriores.
      await tx.query(`UPDATE identity.email_challenges SET consumed_at = $2 WHERE email_key = $1 AND consumed_at IS NULL`, [key, this.clock.now()]);
      await tx.query(
        `INSERT INTO identity.email_challenges (id, email_key, code_hash, ip_key, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz + make_interval(mins => $6), $5)`,
        [id, key, this.codeHash(id, code), ipKey, this.clock.now(), EMAIL_CODE_TTL_MINUTES],
      );
    });
    await this.email.send({ to: email.trim(), ...CODE_EMAIL[lang](code, EMAIL_CODE_TTL_MINUTES) });
  }

  /** Comprueba el código (como mucho 5 intentos por código) e inicia sesión; la cuenta se crea la primera vez. */
  async verifyEmail(email: string, code: string): Promise<Session> {
    await this.consumeEmailCode(email, code);
    return this.identity.signIn("EMAIL", this.emailKey(email), "usuario");
  }

  /**
   * Vincular otro método a la cuenta con sesión (§5.1). Si esa identidad ya pertenece a otra cuenta, no se mueve:
   * fusionar cuentas no es parte de V1.
   */
  async link(userId: string, credential: { provider: "APPLE" | "GOOGLE"; idToken: string } | { provider: "EMAIL"; email: string; code: string }): Promise<void> {
    let subject: string;
    if (credential.provider === "EMAIL") {
      await this.consumeEmailCode(credential.email, credential.code);
      subject = this.emailKey(credential.email);
    } else {
      subject = (await (credential.provider === "APPLE" ? this.oidc.apple : this.oidc.google).verify(credential.idToken)).subject;
    }
    await this.identity.linkIdentity(userId, credential.provider, subject);
  }

  private async consumeEmailCode(email: string, code: string): Promise<void> {
    const key = this.emailKey(email);
    const ok = await withTransaction(this.db, async (tx) => {
      const c = (await tx.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM identity.email_challenges
          WHERE email_key = $1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [key, this.clock.now()],
      )).rows[0];
      if (!c || c.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return false;
      const expected = Buffer.from(c.code_hash, "hex");
      const given = Buffer.from(this.codeHash(c.id, code), "hex");
      const match = expected.length === given.length && timingSafeEqual(expected, given);
      await tx.query(`UPDATE identity.email_challenges SET attempts = attempts + 1, consumed_at = CASE WHEN $2 THEN $3::timestamptz ELSE consumed_at END WHERE id = $1`, [c.id, match, this.clock.now()]);
      return match;
    });
    if (!ok) throw new DomainError("INVALID_CODE", "Código incorrecto o vencido", 401);
  }
}
