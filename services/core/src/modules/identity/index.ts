import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { PUSH_PROVIDER_BY_PLATFORM, type AttestationVerdict, type DevicePlatform, type RegisterPushTokenRequest } from "@dizaster/contracts";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish } from "../../platform/outbox.js";
import type { SocialService } from "../social/index.js";

export type Role = "user" | "moderator" | "admin";

export interface Session {
  userId: string;
  profileId: string;
  roles: Role[];
}

/**
 * Proveedor de identidad externo (Apple, Google, email). La V1 los implementa detrás de esta interfaz;
 * en esta etapa solo existe el proveedor DEV (bloqueado en producción por configuración).
 */
export interface IdentityProviderVerifier {
  readonly provider: "APPLE" | "GOOGLE" | "EMAIL" | "DEV";
  verify(credential: string): Promise<{ subject: string; email?: string }>;
}

/**
 * Verificación de integridad del dispositivo (App Attest / Play Integrity).
 * El cliente envía un token; el servidor obtiene el veredicto. Nunca se confía en lo que dice el cliente.
 */
export interface AttestationVerifier {
  verify(token: string | null, platform: "IOS" | "ANDROID" | null): Promise<AttestationVerdict>;
}

/** Solo desarrollo/tests: "dev-genuine" simula un dispositivo íntegro. */
export class DevAttestationVerifier implements AttestationVerifier {
  async verify(token: string | null): Promise<AttestationVerdict> {
    if (token === null) return "UNAVAILABLE";
    if (token === "dev-genuine") return "GENUINE";
    if (token === "dev-failed") return "FAILED";
    return "UNAVAILABLE";
  }
}

export interface PushTarget {
  userId: string;
  deviceId: string;
  provider: "APNS" | "FCM";
  token: string;
  environment: "development" | "production";
}

/** Vida del token de acceso (JWT) y del refresh token. */
export const ACCESS_TTL_SECONDS = 900;
export const REFRESH_TTL_DAYS = 60;

export interface TokenPair {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export class IdentityService {
  private readonly key: Uint8Array;
  private readonly statusCache = new Map<string, { status: string; at: number }>();

  constructor(
    private readonly db: Db,
    private readonly social: SocialService,
    jwtSecret: string,
  ) {
    this.key = new TextEncoder().encode(jwtSecret);
  }

  /** Alta o login con una identidad externa ya verificada. Crea usuario y perfil personal la primera vez. */
  async signIn(provider: IdentityProviderVerifier["provider"], subject: string, handleHint: string): Promise<Session> {
    return withTransaction(this.db, async (tx) => {
      const existing = await tx.query<{ user_id: string; roles: Role[]; status: string }>(
        `SELECT a.user_id, u.roles, u.status FROM identity.auth_identities a JOIN identity.users u ON u.id = a.user_id
          WHERE a.provider = $1 AND a.subject = $2`,
        [provider, subject],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        // Una cuenta suspendida puede entrar (para ver por qué y apelar) pero no publicar; ver assertCanWrite.
        if (row.status === "DELETED") throw new DomainError("ACCOUNT_INACTIVE", "Cuenta no activa", 403);
        const profile = await this.social.profileForUser(tx, row.user_id);
        return { userId: row.user_id, profileId: profile.id, roles: ["user", ...row.roles] };
      }
      const userId = newId();
      await tx.query(`INSERT INTO identity.users (id) VALUES ($1)`, [userId]);
      await tx.query(
        `INSERT INTO identity.auth_identities (id, user_id, provider, subject, verified_at) VALUES ($1, $2, $3, $4, now())`,
        [newId(), userId, provider, subject],
      );
      const profile = await this.social.createProfile(tx, { userId, handleHint });
      return { userId, profileId: profile.id, roles: ["user"] };
    });
  }

  /** Suspender o reactivar una cuenta (moderación). Surte efecto en todas las instancias en ≤ 30 s. */
  async setUserStatus(q: Queryable, userId: string, status: "ACTIVE" | "SUSPENDED"): Promise<void> {
    await q.query(`UPDATE identity.users SET status = $2, updated_at = now() WHERE id = $1 AND status <> 'DELETED'`, [userId, status]);
    this.statusCache.delete(userId);
  }

  /** Una cuenta suspendida o borrada no puede escribir. Caché corta: una consulta por cuenta cada 30 s como mucho. */
  async assertCanWrite(userId: string): Promise<void> {
    const now = Date.now();
    let cached = this.statusCache.get(userId);
    if (!cached || now - cached.at > 30_000) {
      const { rows } = await this.db.query<{ status: string }>(`SELECT status FROM identity.users WHERE id = $1`, [userId]);
      cached = { status: rows[0]?.status ?? "DELETED", at: now };
      this.statusCache.set(userId, cached);
      if (this.statusCache.size > 10_000) this.statusCache.clear();
    }
    if (cached.status === "SUSPENDED") throw new DomainError("ACCOUNT_SUSPENDED", "Tu cuenta está suspendida. Puedes ver el motivo y apelar en Perfil.", 403);
    if (cached.status !== "ACTIVE") throw new DomainError("ACCOUNT_INACTIVE", "Cuenta no activa", 403);
  }

  async grantRole(userId: string, role: Exclude<Role, "user">): Promise<void> {
    await this.db.query(`UPDATE identity.users SET roles = array(SELECT DISTINCT unnest(roles || $2::text)) WHERE id = $1`, [userId, role]);
  }

  /**
   * Registra un dispositivo o, si el cliente ya tiene uno propio de la misma plataforma, lo reutiliza.
   * Reutilizar evita que cada arranque cree un "dispositivo nuevo" y diluya el anti-abuso por dispositivo.
   */
  async registerDevice(userId: string, platform: DevicePlatform, appVersion: string | null, existingId?: string): Promise<string> {
    if (existingId) {
      const { rows } = await this.db.query<{ id: string }>(
        `UPDATE identity.devices SET last_seen_at = now(), app_version = COALESCE($4, app_version)
          WHERE id = $1 AND user_id = $2 AND platform = $3 RETURNING id`,
        [existingId, userId, platform, appVersion],
      );
      if (rows[0]) return rows[0].id;
    }
    const id = newId();
    await this.db.query(`INSERT INTO identity.devices (id, user_id, platform, app_version) VALUES ($1, $2, $3, $4)`, [
      id, userId, platform, appVersion,
    ]);
    return id;
  }

  /**
   * Guarda el token push del dispositivo. El proveedor debe corresponder a la plataforma (APNs↔iOS, FCM↔Android)
   * y un token solo puede pertenecer a un dispositivo: si reaparece en otro (reinstalación), se mueve.
   */
  async setPushToken(userId: string, deviceId: string, req: RegisterPushTokenRequest): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const device = await this.ownedDevice(tx, userId, deviceId);
      if (!device) throw new DomainError("DEVICE_NOT_FOUND", "Dispositivo inexistente o ajeno", 404);
      if (PUSH_PROVIDER_BY_PLATFORM[device.platform] !== req.provider) {
        throw new DomainError("PUSH_PROVIDER_MISMATCH", `${device.platform} usa ${PUSH_PROVIDER_BY_PLATFORM[device.platform]}`);
      }
      await tx.query(
        `UPDATE identity.devices SET push_token = NULL, push_provider = NULL, push_environment = NULL, push_token_updated_at = now()
          WHERE push_provider = $1 AND push_token = $2 AND id <> $3`,
        [req.provider, req.token, deviceId],
      );
      await tx.query(
        `UPDATE identity.devices SET push_token = $2, push_provider = $3, push_environment = $4, push_token_updated_at = now(), last_seen_at = now()
          WHERE id = $1`,
        [deviceId, req.token, req.provider, req.provider === "APNS" ? req.environment : "production"],
      );
    });
  }

  /** Destinos push de varias cuentas (solo dispositivos con token vigente). */
  async pushTargets(q: Queryable, userIds: string[]): Promise<PushTarget[]> {
    if (userIds.length === 0) return [];
    const { rows } = await q.query<{ user_id: string; id: string; push_provider: "APNS" | "FCM"; push_token: string; push_environment: "development" | "production" }>(
      `SELECT user_id, id, push_provider, push_token, push_environment FROM identity.devices
        WHERE user_id = ANY($1) AND push_token IS NOT NULL`,
      [userIds],
    );
    return rows.map((r) => ({ userId: r.user_id, deviceId: r.id, provider: r.push_provider, token: r.push_token, environment: r.push_environment }));
  }

  /** El proveedor dijo que el token ya no existe (app desinstalada, token rotado): se olvida. */
  async dropPushToken(q: Queryable, provider: "APNS" | "FCM", token: string): Promise<void> {
    await q.query(
      `UPDATE identity.devices SET push_token = NULL, push_provider = NULL, push_environment = NULL, push_token_updated_at = now()
        WHERE push_provider = $1 AND push_token = $2`,
      [provider, token],
    );
  }

  async clearPushToken(userId: string, deviceId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE identity.devices SET push_token = NULL, push_provider = NULL, push_environment = NULL, push_token_updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [deviceId, userId],
    );
    if (!rowCount) throw new DomainError("DEVICE_NOT_FOUND", "Dispositivo inexistente o ajeno", 404);
  }

  /** Devuelve el dispositivo solo si pertenece al usuario (un usuario no puede usar dispositivos ajenos). */
  async ownedDevice(q: Queryable, userId: string, deviceId: string): Promise<{ id: string; platform: DevicePlatform } | null> {
    const { rows } = await q.query<{ id: string; platform: DevicePlatform }>(
      `SELECT id, platform FROM identity.devices WHERE id = $1 AND user_id = $2`,
      [deviceId, userId],
    );
    return rows[0] ?? null;
  }

  /** Cuentas activas desde `since` (un dispositivo suyo se conectó): denominador del costo por 1.000 usuarios. */
  async activeUsers(q: Queryable, since: Date): Promise<number> {
    const { rows } = await q.query<{ n: number }>(`SELECT count(DISTINCT user_id)::int AS n FROM identity.devices WHERE last_seen_at >= $1`, [since]);
    return rows[0]?.n ?? 0;
  }

  /** Antigüedad de cuentas en horas (Trust & Safety: las cuentas nuevas pesan menos en la corroboración). */
  async accountAgeHours(q: Queryable, userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; hours: number }>(
      `SELECT id, EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS hours FROM identity.users WHERE id = ANY($1)`,
      [userIds],
    );
    return new Map(rows.map((r) => [r.id, Number(r.hours)]));
  }

  // ───────────── Sesiones: acceso corto + refresh rotatorio ─────────────

  /** Inicia una familia de sesión. El refresh token solo se guarda como hash. */
  async startSession(session: Session, deviceId: string | null): Promise<TokenPair> {
    return this.issuePair(this.db, session, newId(), deviceId);
  }

  /**
   * Rotación: cada refresh token sirve una sola vez. Si un token ya rotado vuelve a usarse, alguien lo copió:
   * se revoca toda la familia (la persona legítima y quien lo robó tendrán que volver a entrar).
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const invalid = () => new DomainError("INVALID_REFRESH", "Sesión caducada; vuelve a entrar", 401);
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{ id: string; family_id: string; user_id: string; device_id: string | null; expires_at: Date; rotated_at: Date | null; revoked_at: Date | null; status: string; roles: Role[] }>(
        `SELECT s.id, s.family_id, s.user_id, s.device_id, s.expires_at, s.rotated_at, s.revoked_at, u.status, u.roles
           FROM identity.sessions s JOIN identity.users u ON u.id = s.user_id WHERE s.token_hash = $1 FOR UPDATE OF s`,
        [hashToken(refreshToken)],
      );
      const s = rows[0];
      if (!s || s.revoked_at || s.expires_at <= new Date() || s.status === "DELETED") throw invalid();
      if (s.rotated_at) {
        await tx.query(`UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'REUSE_DETECTED' WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id]);
        // Se confirma la revocación aunque la petición falle: la transacción debe terminar bien.
        return null;
      }
      await tx.query(`UPDATE identity.sessions SET rotated_at = now() WHERE id = $1`, [s.id]);
      const profile = await this.social.profileForUser(tx, s.user_id);
      return this.issuePair(tx, { userId: s.user_id, profileId: profile.id, roles: ["user", ...s.roles] }, s.family_id, s.device_id);
    }).then((pair) => {
      if (!pair) throw invalid();
      return pair;
    });
  }

  /** Cerrar sesión en este dispositivo: revoca la familia del token. */
  async logout(refreshToken: string): Promise<void> {
    await this.db.query(
      `UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'LOGOUT'
        WHERE family_id = (SELECT family_id FROM identity.sessions WHERE token_hash = $1) AND revoked_at IS NULL`,
      [hashToken(refreshToken)],
    );
  }

  private async issuePair(q: Queryable, session: Session, familyId: string, deviceId: string | null): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString("base64url");
    await q.query(
      `INSERT INTO identity.sessions (id, family_id, user_id, device_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
      [newId(), familyId, session.userId, deviceId, hashToken(refreshToken), REFRESH_TTL_DAYS],
    );
    return { token: await this.issueToken(session), refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  // ───────────── Borrar cuenta (exigido por App Store y Google Play) ─────────────

  /**
   * Borra la cuenta: queda marcada DELETED, se cierran todas sus sesiones, se olvidan dispositivos y proveedores de
   * acceso, y `AccountDeleted` hace que cada módulo elimine o anonimice lo suyo en la misma transacción del outbox.
   */
  async deleteAccount(userId: string, profileId: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { rowCount } = await tx.query(`UPDATE identity.users SET status = 'DELETED', deleted_at = now(), roles = '{}', updated_at = now() WHERE id = $1 AND status <> 'DELETED'`, [userId]);
      if (!rowCount) return;
      await tx.query(`UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'ACCOUNT_DELETED' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await tx.query(`UPDATE identity.devices SET push_token = NULL, push_provider = NULL, push_environment = NULL, push_token_updated_at = now() WHERE user_id = $1`, [userId]);
      // Sin vínculo con Apple/Google/email: volver a entrar con la misma identidad crea una cuenta nueva.
      await tx.query(`DELETE FROM identity.auth_identities WHERE user_id = $1`, [userId]);
      await publish(tx, "AccountDeleted", { userId, profileId }, { lane: "interactive" });
    });
    this.statusCache.delete(userId);
  }

  async issueToken(session: Session, ttlSeconds = ACCESS_TTL_SECONDS): Promise<string> {
    return new SignJWT({ pid: session.profileId, roles: session.roles })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(session.userId)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .setIssuer("dizaster")
      .sign(this.key);
  }

  async verifyToken(token: string): Promise<Session> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: "dizaster", algorithms: ["HS256"] });
      return { userId: String(payload.sub), profileId: String(payload.pid), roles: (payload.roles as Role[]) ?? ["user"] };
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Sesión inválida o expirada", 401);
    }
  }

  /** Personas con un rol (p. ej. administración, para avisos operativos). Excluye cuentas suspendidas o borradas. */
  async usersWithRole(q: Queryable, role: Exclude<Role, "user">): Promise<string[]> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM identity.users WHERE $1 = ANY(roles) AND status = 'ACTIVE'`, [role]);
    return rows.map((r) => r.id);
  }
}
