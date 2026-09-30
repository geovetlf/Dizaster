import { createHash, createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ageAt, PUSH_PROVIDER_BY_PLATFORM, type AttestationVerdict, type DevicePlatform, type RegisterPushTokenRequest, type RegisterSigningKeyRequest, type SessionView } from "@dizaster/contracts";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish } from "../../platform/outbox.js";
import type { SocialService } from "../social/index.js";

export type { Role } from "@dizaster/contracts";
import { STAFF_ROLES, type AcceptPoliciesRequest, type LegalDocument, type PolicyStatusResponse, type Role, type StaffRole } from "@dizaster/contracts";

export interface Session {
  userId: string;
  profileId: string;
  roles: Role[];
  /** Inicio de sesión (familia de refresh tokens) al que pertenece el token de acceso. */
  sessionId?: string;
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
  private readonly statusCache = new Map<string, { status: string; ageOk: boolean; at: number }>();

  constructor(
    private readonly db: Db,
    private readonly social: SocialService,
    jwtSecret: string,
  ) {
    this.key = new TextEncoder().encode(jwtSecret);
    this.hardwareSecret = createHmac("sha256", jwtSecret).update("device-hardware-key:v1").digest();
  }

  private readonly hardwareSecret: Buffer;

  /** Clave seudónima del teléfono (ADR 0068): HMAC con secreto del servidor; sin el secreto no se puede revertir ni cruzar. */
  hardwareKey(platform: DevicePlatform, hardwareId: string): string {
    return createHmac("sha256", this.hardwareSecret).update(`${platform}:${hardwareId}`).digest("base64url");
  }

  /** Vincula otra identidad a la cuenta (ADR 0170). Una identidad de otra cuenta no se mueve. */
  async linkIdentity(userId: string, provider: IdentityProviderVerifier["provider"], subject: string): Promise<void> {
    const owner = (await this.db.query<{ user_id: string }>(`SELECT user_id FROM identity.auth_identities WHERE provider = $1 AND subject = $2`, [provider, subject])).rows[0];
    if (owner?.user_id === userId) return;
    if (owner) throw new DomainError("IDENTITY_IN_USE", "Ese método ya está vinculado a otra cuenta", 409);
    await this.db.query(
      `INSERT INTO identity.auth_identities (id, user_id, provider, subject, verified_at) VALUES ($1, $2, $3, $4, now())`, [newId(), userId, provider, subject],
    );
  }

  /** Métodos de inicio de sesión de la cuenta (sin datos: solo cuáles). */
  async linkedProviders(userId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ provider: string }>(`SELECT DISTINCT provider FROM identity.auth_identities WHERE user_id = $1 ORDER BY provider`, [userId]);
    return rows.map((r) => r.provider);
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
    this.rolesCache.delete(userId);
  }

  // ───────────── Términos y políticas (ADR 0176) ─────────────

  /** Estado de cada documento publicado (con versión). Lo que aún no tiene versión no aparece. */
  async policyStatus(q: Queryable, userId: string, docs: readonly LegalDocument[]): Promise<PolicyStatusResponse> {
    const live = docs.filter((d): d is LegalDocument & { version: string; url: string } => d.version !== null && d.url !== null);
    if (live.length === 0) return { documents: [] };
    const { rows } = await q.query<{ kind: string; version: string }>(
      `SELECT DISTINCT ON (kind) kind, version FROM identity.policy_acceptances WHERE user_id = $1 ORDER BY kind, accepted_at DESC`, [userId],
    );
    const last = new Map(rows.map((r) => [r.kind, r.version]));
    const accepted = new Set((await q.query<{ k: string }>(
      `SELECT kind || ':' || version AS k FROM identity.policy_acceptances WHERE user_id = $1`, [userId],
    )).rows.map((r) => r.k));
    return {
      documents: live.map((d) => ({
        kind: d.kind, version: d.version, url: d.url, required: d.required,
        acceptedVersion: last.get(d.kind) ?? null, pending: !accepted.has(`${d.kind}:${d.version}`),
      })),
    };
  }

  /** Solo se acepta la versión vigente; aceptar dos veces la misma no cambia nada. */
  async acceptPolicies(
    userId: string, req: AcceptPoliciesRequest, docs: readonly LegalDocument[], client: { platform: string | null; appVersion: string | null },
  ): Promise<void> {
    for (const a of req.accept) {
      const d = docs.find((x) => x.kind === a.kind);
      if (!d?.version || d.version !== a.version) throw new DomainError("POLICY_VERSION_MISMATCH", "Esa versión ya no es la vigente", 409);
    }
    for (const a of req.accept) {
      await this.db.query(
        `INSERT INTO identity.policy_acceptances (id, user_id, kind, version, platform, app_version) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, kind, version) DO NOTHING`,
        [newId(), userId, a.kind, a.version, client.platform, client.appVersion],
      );
    }
    this.policyCache.delete(userId);
  }

  private readonly policyCache = new Map<string, { key: string; at: number }>();

  /**
   * Publicar e interactuar exigen haber aceptado la versión vigente de lo marcado `required` (ADR 0176). Sin textos
   * publicados no hay nada que exigir ni consulta. Caché de 30 s por cuenta y conjunto de versiones.
   */
  async assertPoliciesAccepted(userId: string, docs: readonly LegalDocument[]): Promise<void> {
    const required = docs.filter((d) => d.required && d.version !== null);
    if (required.length === 0) return;
    const key = required.map((d) => `${d.kind}:${d.version}`).sort().join(",");
    const hit = this.policyCache.get(userId);
    if (hit && hit.key === key && Date.now() - hit.at < 30_000) return;
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.policy_acceptances WHERE user_id = $1 AND kind || ':' || version = ANY($2)`,
      [userId, required.map((d) => `${d.kind}:${d.version}`)],
    );
    if (rows[0]!.n < required.length) {
      throw new DomainError("POLICY_ACCEPTANCE_REQUIRED", "Acepta los términos vigentes para continuar", 428);
    }
    this.policyCache.set(userId, { key, at: Date.now() });
  }

  /** Una cuenta suspendida o borrada no puede escribir. Caché corta: una consulta por cuenta cada 30 s como mucho. */
  async assertCanWrite(userId: string, opts: { requireAge?: boolean } = {}): Promise<void> {
    const now = Date.now();
    let cached = this.statusCache.get(userId);
    if (!cached || now - cached.at > 30_000) {
      const { rows } = await this.db.query<{ status: string; age_ok: boolean }>(
        `SELECT status, age_confirmed_at IS NOT NULL AS age_ok FROM identity.users WHERE id = $1`, [userId],
      );
      cached = { status: rows[0]?.status ?? "DELETED", ageOk: rows[0]?.age_ok ?? false, at: now };
      this.statusCache.set(userId, cached);
      if (this.statusCache.size > 10_000) this.statusCache.clear();
    }
    if (cached.status === "SUSPENDED") throw new DomainError("ACCOUNT_SUSPENDED", "Tu cuenta está suspendida. Puedes ver el motivo y apelar en Perfil.", 403);
    if (cached.status !== "ACTIVE") throw new DomainError("ACCOUNT_INACTIVE", "Cuenta no activa", 403);
    // Edad mínima (D-13): sin declararla se puede leer, pero no publicar, reportar ni interactuar.
    if (opts.requireAge && !cached.ageOk) throw new DomainError("AGE_CONFIRMATION_REQUIRED", "Confirma tu edad para publicar", 403);
  }

  /**
   * Declarar la edad (ADR 0049). Solo se guarda que cumple el mínimo aplicado y cuándo se declaró. Por debajo del
   * mínimo no se guarda nada y la cuenta sigue sin poder publicar.
   */
  async confirmAge(userId: string, birthYear: number, birthMonth: number, minAge: number, now = new Date()): Promise<{ ok: true; minAge: number }> {
    if (ageAt(birthYear, birthMonth, now) < minAge) {
      throw new DomainError("UNDER_MIN_AGE", `Dizaster es para mayores de ${minAge} años`, 403);
    }
    await this.db.query(
      `UPDATE identity.users SET age_confirmed_min = GREATEST(coalesce(age_confirmed_min, 0), $2), age_confirmed_at = coalesce(age_confirmed_at, now()) WHERE id = $1`,
      [userId, minAge],
    );
    this.statusCache.delete(userId);
    return { ok: true, minAge };
  }

  async ageConfirmed(userId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ ok: boolean }>(`SELECT age_confirmed_at IS NOT NULL AS ok FROM identity.users WHERE id = $1`, [userId]);
    return rows[0]?.ok ?? false;
  }

  /** Dar un rol de personal, con registro (ADR 0167). Vale desde el próximo inicio de sesión. */
  async grantRole(userId: string, role: StaffRole, actor = "CLI", reason = "Asignado por CLI"): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const r = await tx.query(
        `UPDATE identity.users SET roles = array(SELECT DISTINCT unnest(roles || $2::text)), updated_at = now() WHERE id = $1 AND NOT ($2 = ANY(roles))`,
        [userId, role],
      );
      if (!r.rowCount) return;
      await tx.query(`INSERT INTO identity.role_changes (id, user_id, role, action, actor, reason) VALUES ($1, $2, $3, 'GRANT', $4, $5)`, [newId(), userId, role, actor, reason]);
    });
    this.rolesCache.delete(userId);
  }

  /**
   * Quitar un rol (ADR 0167): con registro, nunca al último administrador, y cerrando todas sus sesiones para que no
   * siga usándolo con un token ya emitido. Además `liveRoles` lo deja de aceptar en ≤ 30 s.
   */
  async revokeRole(userId: string, role: StaffRole, actor: string, reason: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      // Serializa las bajas de administradores: dos a la vez no pueden dejar el sistema sin ninguno.
      if (role === "admin") await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('identity.admin-revoke', 0))`);
      const has = await tx.query(`SELECT 1 FROM identity.users WHERE id = $1 AND $2 = ANY(roles) FOR UPDATE`, [userId, role]);
      if (!has.rowCount) throw new DomainError("CONFLICT", "La cuenta no tiene ese rol", 409);
      if (role === "admin") {
        const admins = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.users WHERE 'admin' = ANY(roles) AND status = 'ACTIVE'`);
        if ((admins.rows[0]?.n ?? 0) <= 1) throw new DomainError("LAST_ADMIN", "No se puede quitar el rol al último administrador", 409);
      }
      await tx.query(`UPDATE identity.users SET roles = array_remove(roles, $2), updated_at = now() WHERE id = $1`, [userId, role]);
      await tx.query(`INSERT INTO identity.role_changes (id, user_id, role, action, actor, reason) VALUES ($1, $2, $3, 'REVOKE', $4, $5)`, [newId(), userId, role, actor, reason]);
      await tx.query(`UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'ROLE_REVOKED' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    });
    this.rolesCache.delete(userId);
  }

  private readonly rolesCache = new Map<string, { roles: string[]; at: number }>();
  /**
   * Roles vigentes en la base (caché de 30 s): un rol quitado deja de valer aunque el token siga vivo. Una cuenta
   * suspendida no ejerce ningún rol (ADR 0214): así no puede reactivarse ni decidir sobre nada mientras dure.
   */
  async liveRoles(userId: string): Promise<string[]> {
    const now = Date.now();
    const hit = this.rolesCache.get(userId);
    if (hit && now - hit.at <= 30_000) return hit.roles;
    const { rows } = await this.db.query<{ roles: string[] }>(`SELECT roles FROM identity.users WHERE id = $1 AND status = 'ACTIVE'`, [userId]);
    const roles = rows[0]?.roles ?? [];
    this.rolesCache.set(userId, { roles, at: now });
    if (this.rolesCache.size > 10_000) this.rolesCache.clear();
    return roles;
  }

  /** Personal con roles y últimos cambios (ADR 0167). Los handles los pone quien llama. */
  async staff(): Promise<{ members: { userId: string; roles: StaffRole[] }[]; changes: { userId: string; role: StaffRole; action: "GRANT" | "REVOKE"; reason: string; at: Date }[] }> {
    const members = await this.db.query<{ id: string; roles: string[] }>(
      `SELECT id, roles FROM identity.users WHERE roles && $1::text[] AND status <> 'DELETED' ORDER BY id`, [[...STAFF_ROLES]],
    );
    const changes = await this.db.query<{ user_id: string; role: StaffRole; action: "GRANT" | "REVOKE"; reason: string; at: Date }>(
      `SELECT user_id, role, action, reason, at FROM identity.role_changes ORDER BY at DESC LIMIT 50`,
    );
    return {
      members: members.rows.map((r) => ({ userId: r.id, roles: r.roles.filter((x): x is StaffRole => (STAFF_ROLES as readonly string[]).includes(x)) })),
      changes: changes.rows.map((r) => ({ userId: r.user_id, role: r.role, action: r.action, reason: r.reason, at: r.at })),
    };
  }

  /**
   * Registra un dispositivo o, si el cliente ya tiene uno propio de la misma plataforma, lo reutiliza.
   * Reutilizar evita que cada arranque cree un "dispositivo nuevo" y diluya el anti-abuso por dispositivo.
   */
  async registerDevice(userId: string, platform: DevicePlatform, appVersion: string | null, existingId?: string, hardwareId?: string): Promise<string> {
    const hwKey = hardwareId ? this.hardwareKey(platform, hardwareId) : null;
    if (existingId) {
      const { rows } = await this.db.query<{ id: string }>(
        `UPDATE identity.devices SET last_seen_at = now(), app_version = COALESCE($4, app_version), hardware_key = COALESCE($5, hardware_key)
          WHERE id = $1 AND user_id = $2 AND platform = $3 RETURNING id`,
        [existingId, userId, platform, appVersion, hwKey],
      );
      if (rows[0]) return rows[0].id;
    }
    const id = newId();
    await this.db.query(`INSERT INTO identity.devices (id, user_id, platform, app_version, hardware_key) VALUES ($1, $2, $3, $4, $5)`, [
      id, userId, platform, appVersion, hwKey,
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
  /**
   * Clave pública de firma de la evidencia (ADR 0129). Registrar la misma es idempotente; una nueva reemplaza a la
   * actual, que sigue valiendo para lo capturado antes del reemplazo (la cola offline puede traer reportes firmados).
   */
  async registerSigningKey(userId: string, deviceId: string, req: RegisterSigningKeyRequest): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const device = await this.ownedDevice(tx, userId, deviceId);
      if (!device) throw new DomainError("DEVICE_NOT_FOUND", "Dispositivo inexistente o ajeno", 404);
      await tx.query(`SELECT 1 FROM identity.devices WHERE id = $1 FOR UPDATE`, [deviceId]);
      const current = await tx.query<{ public_key: string }>(
        `SELECT public_key FROM identity.device_signing_keys WHERE device_id = $1 AND replaced_at IS NULL`, [deviceId]);
      if (current.rows[0]?.public_key === req.publicKey) return;
      const known = await tx.query(`SELECT 1 FROM identity.device_signing_keys WHERE device_id = $1 AND public_key = $2`, [deviceId, req.publicKey]);
      if (known.rows[0]) throw new DomainError("SIGNING_KEY_REUSED", "Esa clave ya fue reemplazada en este dispositivo", 409);
      await tx.query(`UPDATE identity.device_signing_keys SET replaced_at = now() WHERE device_id = $1 AND replaced_at IS NULL`, [deviceId]);
      await tx.query(`INSERT INTO identity.device_signing_keys (id, device_id, public_key) VALUES ($1, $2, $3)`, [newId(), deviceId, req.publicKey]);
    });
  }

  /**
   * El teléfono de un dispositivo (ADR 0131): todos los registros con la misma clave de hardware (o solo él, sin clave),
   * y si alguna cuenta de ese teléfono está suspendida. Para cupos y reputación por teléfono, no por cuenta.
   */
  async phoneOf(q: Queryable, deviceId: string): Promise<{ deviceIds: string[]; suspendedAccount: boolean }> {
    const { rows } = await q.query<{ id: string; suspended: boolean }>(
      `SELECT o.id, u.status = 'SUSPENDED' AS suspended
         FROM identity.devices d
         JOIN identity.devices o ON o.id = d.id OR (d.hardware_key IS NOT NULL AND o.hardware_key = d.hardware_key)
         JOIN identity.users u ON u.id = o.user_id
        WHERE d.id = $1`, [deviceId]);
    return { deviceIds: rows.map((r) => r.id), suspendedAccount: rows.some((r) => r.suspended) };
  }

  /** La clave de firma de un dispositivo, con cuándo se registró y, si fue reemplazada, cuándo. */
  async signingKey(q: Queryable, deviceId: string, publicKey: string): Promise<{ createdAt: Date; replacedAt: Date | null } | null> {
    const { rows } = await q.query<{ created_at: Date; replaced_at: Date | null }>(
      `SELECT created_at, replaced_at FROM identity.device_signing_keys WHERE device_id = $1 AND public_key = $2`, [deviceId, publicKey]);
    return rows[0] ? { createdAt: rows[0].created_at, replacedAt: rows[0].replaced_at } : null;
  }

  /**
   * Teléfono de la sesión (ADR 0207): el dispositivo con el que se inició esta sesión, resuelto a su `phoneId`
   * (ADR 0068). Null si el token es anterior a los ids de sesión o la sesión no registró dispositivo.
   */
  async sessionPhone(q: Queryable, userId: string, sessionId: string | undefined): Promise<string | null> {
    if (!sessionId) return null;
    const { rows } = await q.query<{ device_id: string }>(
      `SELECT device_id FROM identity.sessions WHERE family_id = $1 AND user_id = $2 AND device_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [sessionId, userId],
    );
    const deviceId = rows[0]?.device_id;
    return deviceId ? ((await this.ownedDevice(q, userId, deviceId))?.phoneId ?? null) : null;
  }

  async ownedDevice(q: Queryable, userId: string, deviceId: string): Promise<{ id: string; platform: DevicePlatform; phoneId: string } | null> {
    // phoneId: el primer registro de este mismo teléfono, sea de la cuenta que sea (ADR 0068). Sin clave, el propio.
    const { rows } = await q.query<{ id: string; platform: DevicePlatform; phone_id: string }>(
      `SELECT d.id, d.platform,
              coalesce((SELECT o.id FROM identity.devices o WHERE o.hardware_key = d.hardware_key ORDER BY o.created_at, o.id LIMIT 1), d.id) AS phone_id
         FROM identity.devices d WHERE d.id = $1 AND d.user_id = $2`,
      [deviceId, userId],
    );
    const r = rows[0];
    return r ? { id: r.id, platform: r.platform, phoneId: r.phone_id } : null;
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
    return { token: await this.issueToken({ ...session, sessionId: familyId }), refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  // ───────────── Sesiones abiertas (ADR 0029) ─────────────

  /** Inicios de sesión activos de la cuenta, el más reciente primero. */
  async sessions(userId: string, currentSessionId: string | null): Promise<SessionView[]> {
    const { rows } = await this.db.query<{ family_id: string; platform: DevicePlatform | null; app_version: string | null; started: Date; last: Date }>(
      `SELECT s.family_id, d.platform, d.app_version, min(s.created_at) AS started, max(s.created_at) AS last
         FROM identity.sessions s LEFT JOIN identity.devices d ON d.id = s.device_id
        WHERE s.user_id = $1
        GROUP BY s.family_id, d.platform, d.app_version
       HAVING bool_or(s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.expires_at > now())
        ORDER BY max(s.created_at) DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.family_id, platform: r.platform, appVersion: r.app_version, startedAt: r.started.toISOString(), lastActiveAt: r.last.toISOString(),
      current: r.family_id === currentSessionId,
    }));
  }

  /**
   * Cierra inicios de sesión: uno concreto o todos menos el actual. El token de acceso que ya tuviera ese
   * dispositivo deja de renovarse y caduca en ≤ 15 min. Si un dispositivo queda sin sesiones, deja de recibir
   * avisos (un teléfono perdido no sigue mostrando alertas).
   */
  async revokeSessions(userId: string, which: { id: string } | { allExcept: string | null }): Promise<number> {
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{ device_id: string | null }>(
        "id" in which
          ? `UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'REVOKED_BY_USER'
              WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL RETURNING device_id`
          : `UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'REVOKED_BY_USER'
              WHERE user_id = $1 AND ($2::uuid IS NULL OR family_id <> $2) AND revoked_at IS NULL RETURNING device_id`,
        [userId, "id" in which ? which.id : which.allExcept],
      );
      const devices = [...new Set(rows.flatMap((r) => (r.device_id ? [r.device_id] : [])))];
      if (devices.length) {
        await tx.query(
          `UPDATE identity.devices d SET push_token = NULL, push_provider = NULL, push_environment = NULL, push_token_updated_at = now()
            WHERE d.id = ANY($1) AND d.user_id = $2
              AND NOT EXISTS (SELECT 1 FROM identity.sessions s WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.expires_at > now())`,
          [devices, userId],
        );
      }
      return rows.length;
    });
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
      // Segundo factor (ADR 0090): nada de él sobrevive a la cuenta.
      for (const table of ["mfa_recovery_codes", "mfa_verified_sessions", "mfa_totp", "mfa_failures"]) {
        await tx.query(`DELETE FROM identity.${table} WHERE user_id = $1`, [userId]);
      }
      // Consentimiento (ADR 0184): se conserva solo id interno, documento, versión y fecha.
      await tx.query(`UPDATE identity.policy_acceptances SET platform = NULL, app_version = NULL WHERE user_id = $1`, [userId]);
      await publish(tx, "AccountDeleted", { userId, profileId }, { lane: "interactive" });
    });
    this.statusCache.delete(userId);
  }

  async issueToken(session: Session, ttlSeconds = ACCESS_TTL_SECONDS): Promise<string> {
    return new SignJWT({ pid: session.profileId, roles: session.roles, ...(session.sessionId ? { sid: session.sessionId } : {}) })
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
      return {
        userId: String(payload.sub), profileId: String(payload.pid), roles: (payload.roles as Role[]) ?? ["user"],
        ...(typeof payload.sid === "string" ? { sessionId: payload.sid } : {}),
      };
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Sesión inválida o expirada", 401);
    }
  }

  /** Personas con un rol (p. ej. administración, para avisos operativos). Excluye cuentas suspendidas o borradas. */
  async usersWithRole(q: Queryable, role: StaffRole): Promise<string[]> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM identity.users WHERE $1 = ANY(roles) AND status = 'ACTIVE'`, [role]);
    return rows.map((r) => r.id);
  }
  /**
   * Retención de identidad (ADR 0210, §13.2). Los códigos de acceso por correo solo sirven 1 h (límite por hora) y
   * los fallos de MFA 15 min (bloqueo). Se borran a las 24 h. Lo llama el worker una vez al día.
   */
  async applyRetention(q: Queryable, now: Date): Promise<{ emailChallenges: number; mfaFailures: number }> {
    const email = await q.query(`DELETE FROM identity.email_challenges WHERE created_at < $1::timestamptz - interval '24 hours'`, [now]);
    const mfa = await q.query(`DELETE FROM identity.mfa_failures WHERE at < $1::timestamptz - interval '24 hours'`, [now]);
    return { emailChallenges: email.rowCount ?? 0, mfaFailures: mfa.rowCount ?? 0 };
  }

  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  /** Cuenta, dispositivos, sesiones y aceptaciones. Sin secretos: ni hashes de token ni tokens push. */
  async exportData(q: Queryable, userId: string): Promise<Record<string, unknown[]>> {
    const account = await q.query(`SELECT id, status, roles, primary_locale, created_at FROM identity.users WHERE id = $1`, [userId]);
    const logins = await q.query(`SELECT provider, verified_at, created_at FROM identity.auth_identities WHERE user_id = $1`, [userId]);
    const devices = await q.query(
      `SELECT id, platform, app_version, attestation_status, push_token IS NOT NULL AS push_enabled, created_at, last_seen_at
         FROM identity.devices WHERE user_id = $1 ORDER BY created_at`, [userId],
    );
    const sessions = await q.query(
      `SELECT id, device_id, created_at, expires_at, revoked_at, revoke_reason FROM identity.sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`, [userId],
    );
    // Historial de consentimiento (ADR 0209): qué documento y versión acepté, cuándo y desde qué plataforma.
    const policyAcceptances = await q.query(
      `SELECT kind, version, platform, app_version, accepted_at FROM identity.policy_acceptances WHERE user_id = $1 ORDER BY accepted_at`, [userId],
    );
    return { account: account.rows, logins: logins.rows, devices: devices.rows, sessions: sessions.rows, policyAcceptances: policyAcceptances.rows };
  }
}

export { MfaService } from "./mfa.js";
export { ExternalAuthService, OidcIdTokenVerifier, APPLE_ISSUERS, GOOGLE_ISSUERS, appleKeys, googleKeys, normalizeEmail } from "./external-auth.js";
