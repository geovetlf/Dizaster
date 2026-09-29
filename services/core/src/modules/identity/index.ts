import { SignJWT, jwtVerify } from "jose";
import { PUSH_PROVIDER_BY_PLATFORM, type AttestationVerdict, type DevicePlatform, type RegisterPushTokenRequest } from "@dizaster/contracts";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
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

export class IdentityService {
  private readonly key: Uint8Array;

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
        if (row.status !== "ACTIVE") throw new DomainError("ACCOUNT_INACTIVE", "Cuenta no activa", 403);
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

  /** Antigüedad de cuentas en horas (Trust & Safety: las cuentas nuevas pesan menos en la corroboración). */
  async accountAgeHours(q: Queryable, userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; hours: number }>(
      `SELECT id, EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS hours FROM identity.users WHERE id = ANY($1)`,
      [userIds],
    );
    return new Map(rows.map((r) => [r.id, Number(r.hours)]));
  }

  async issueToken(session: Session, ttlSeconds = 900): Promise<string> {
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
}
