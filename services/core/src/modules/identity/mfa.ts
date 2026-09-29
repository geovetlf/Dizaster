import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Clock } from "../../platform/clock.js";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import type { FieldCipher } from "../../platform/field-cipher.js";
import type { Session } from "./index.js";

/**
 * MFA TOTP para moderación y administración (ADR 0090, Blueprint §13.1: "MFA para todo acceso administrativo").
 * RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s) con node:crypto: sin paquetes ni proveedor externo, y compatible con
 * cualquier app de autenticación. NO AI REQUIRED. Costo: 0.
 */
export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;
/** Una verificación vale para el inicio de sesión (familia de tokens) durante este tiempo. */
export const MFA_SESSION_HOURS = 12;
export const RECOVERY_CODES = 8;
/** Intentos fallidos por cuenta en 15 minutos antes de bloquear nuevos intentos. */
export const MFA_MAX_FAILURES = 5;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 inválido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) para un contador. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (at: Date) => Math.floor(at.getTime() / 1000 / TOTP_STEP_S);

/** Paso que coincide dentro de ±1 (reloj del teléfono algo desviado), o null. Comparación en tiempo constante. */
export function matchTotp(secret: Buffer, code: string, at: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code.toUpperCase().replace(/[\s-]/g, "")}`).digest("hex");

export class MfaService {
  constructor(
    private readonly db: Db,
    private readonly cipher: FieldCipher,
    private readonly clock: Clock,
    /** Si false (desarrollo y pruebas por defecto), los roles de personal no exigen MFA. En producción siempre true. */
    readonly required: boolean,
  ) {}

  async status(q: Queryable, userId: string): Promise<{ enrolled: boolean; recoveryCodesLeft: number }> {
    const { rows } = await q.query<{ confirmed: boolean; left: number }>(
      `SELECT t.confirmed_at IS NOT NULL AS confirmed,
              (SELECT count(*)::int FROM identity.mfa_recovery_codes r WHERE r.user_id = t.user_id AND r.used_at IS NULL) AS left
         FROM identity.mfa_totp t WHERE t.user_id = $1`,
      [userId],
    );
    return { enrolled: rows[0]?.confirmed ?? false, recoveryCodesLeft: rows[0]?.left ?? 0 };
  }

  /** Genera un secreto nuevo (sin confirmar). No reemplaza uno ya confirmado. */
  async enroll(userId: string, accountLabel: string): Promise<{ secret: string; otpauthUri: string }> {
    const secret = randomBytes(20);
    const enc = this.cipher.encrypt(secret.toString("base64"), `mfa:${userId}`);
    const res = await this.db.query(
      `INSERT INTO identity.mfa_totp (user_id, secret_enc) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = excluded.secret_enc, last_step = NULL, created_at = now()
        WHERE identity.mfa_totp.confirmed_at IS NULL`,
      [userId, enc],
    );
    if (res.rowCount === 0) throw new DomainError("MFA_ALREADY_ENROLLED", "Ya hay un autenticador activo; desactívalo primero", 409);
    const b32 = base32Encode(secret);
    const label = encodeURIComponent(`Dizaster:${accountLabel}`);
    return { secret: b32, otpauthUri: `otpauth://totp/${label}?secret=${b32}&issuer=Dizaster&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_S}` };
  }

  /** Confirma el alta con un código válido y entrega los códigos de recuperación (se muestran una sola vez). */
  async confirm(userId: string, sessionId: string | undefined, code: string): Promise<{ recoveryCodes: string[] }> {
    return withTransaction(this.db, async (tx) => {
      const secret = await this.secret(tx, userId, false);
      await this.checkCode(tx, userId, secret, code);
      await tx.query(`UPDATE identity.mfa_totp SET confirmed_at = now() WHERE user_id = $1`, [userId]);
      const codes = Array.from({ length: RECOVERY_CODES }, () => base32Encode(randomBytes(5)).slice(0, 8).replace(/(.{4})/, "$1-"));
      await tx.query(`DELETE FROM identity.mfa_recovery_codes WHERE user_id = $1`, [userId]);
      await tx.query(
        `INSERT INTO identity.mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`,
        [userId, codes.map((c) => hashCode(userId, c))],
      );
      if (sessionId) await this.markSession(tx, userId, sessionId);
      return { recoveryCodes: codes };
    });
  }

  /** Verifica esta sesión con un código TOTP o uno de recuperación (de un solo uso). */
  async verify(userId: string, sessionId: string | undefined, input: { code?: string; recoveryCode?: string }): Promise<{ verifiedUntil: string }> {
    if (!sessionId) throw new DomainError("MFA_SESSION_REQUIRED", "Inicia sesión de nuevo para verificar", 401);
    return withTransaction(this.db, async (tx) => {
      const secret = await this.secret(tx, userId, true);
      if (input.recoveryCode) {
        await this.assertNotLocked(tx, userId);
        const used = await tx.query(
          `UPDATE identity.mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
          [userId, hashCode(userId, input.recoveryCode)],
        );
        if (!used.rowCount) { await this.fail(userId); throw invalidCode(); }
      } else {
        await this.checkCode(tx, userId, secret, input.code ?? "");
      }
      const until = await this.markSession(tx, userId, sessionId);
      return { verifiedUntil: until.toISOString() };
    });
  }

  /** Desactivar exige un código válido: quien robó solo el teléfono desbloqueado no la apaga sin la app. */
  async disable(userId: string, code: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const secret = await this.secret(tx, userId, true);
      await this.checkCode(tx, userId, secret, code);
      await tx.query(`DELETE FROM identity.mfa_recovery_codes WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM identity.mfa_verified_sessions WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM identity.mfa_totp WHERE user_id = $1`, [userId]);
    });
  }

  /**
   * Guarda de moderación y administración: con MFA exigida, la cuenta debe tener un autenticador y esta sesión
   * debe haberse verificado en las últimas MFA_SESSION_HOURS.
   */
  async assertStaff(session: Session): Promise<void> {
    if (!this.required) return;
    const { rows } = await this.db.query<{ enrolled: boolean; verified: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM identity.mfa_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL) AS enrolled,
              EXISTS (SELECT 1 FROM identity.mfa_verified_sessions WHERE family_id = $2 AND user_id = $1
                        AND verified_at > $3::timestamptz - make_interval(hours => $4)) AS verified`,
      [session.userId, session.sessionId ?? "00000000-0000-0000-0000-000000000000", this.clock.now(), MFA_SESSION_HOURS],
    );
    if (!rows[0]!.enrolled) throw new DomainError("MFA_ENROLLMENT_REQUIRED", "Activa la verificación en dos pasos para usar las herramientas de moderación", 403);
    if (!rows[0]!.verified) throw new DomainError("MFA_REQUIRED", "Verifica tu código de dos pasos", 403);
  }

  private async secret(q: Queryable, userId: string, confirmed: boolean): Promise<Buffer> {
    const { rows } = await q.query<{ secret_enc: string; confirmed_at: Date | null }>(
      `SELECT secret_enc, confirmed_at FROM identity.mfa_totp WHERE user_id = $1 FOR UPDATE`, [userId],
    );
    const r = rows[0];
    if (!r || (confirmed && !r.confirmed_at)) throw new DomainError("MFA_NOT_ENROLLED", "No hay un autenticador activo", 409);
    if (!confirmed && r.confirmed_at) throw new DomainError("MFA_ALREADY_ENROLLED", "El autenticador ya está confirmado", 409);
    return Buffer.from(this.cipher.decrypt(r.secret_enc, `mfa:${userId}`), "base64");
  }

  /** Código válido y no reutilizado (cada paso de 30 s sirve una sola vez), con límite de intentos fallidos. */
  private async checkCode(tx: Queryable, userId: string, secret: Buffer, code: string): Promise<void> {
    await this.assertNotLocked(tx, userId);
    const step = matchTotp(secret, code.trim(), this.clock.now());
    const last = (await tx.query<{ last_step: string | null }>(`SELECT last_step FROM identity.mfa_totp WHERE user_id = $1`, [userId])).rows[0]?.last_step;
    if (step === null || (last !== null && last !== undefined && step <= Number(last))) {
      await this.fail(userId);
      throw invalidCode();
    }
    await tx.query(`UPDATE identity.mfa_totp SET last_step = $2 WHERE user_id = $1`, [userId, step]);
  }

  private async assertNotLocked(q: Queryable, userId: string): Promise<void> {
    const n = (await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.mfa_failures WHERE user_id = $1 AND at > $2::timestamptz - interval '15 minutes'`,
      [userId, this.clock.now()],
    )).rows[0]!.n;
    if (n >= MFA_MAX_FAILURES) throw new DomainError("RATE_LIMITED", "Demasiados códigos incorrectos; espera 15 minutos", 429);
  }

  /** El fallo se registra fuera de la transacción del intento, para que el rollback no lo borre. */
  private async fail(userId: string): Promise<void> {
    await this.db.query(`INSERT INTO identity.mfa_failures (user_id, at) VALUES ($1, $2)`, [userId, this.clock.now()]);
  }

  private async markSession(q: Queryable, userId: string, familyId: string): Promise<Date> {
    const now = this.clock.now();
    await q.query(
      `INSERT INTO identity.mfa_verified_sessions (family_id, user_id, verified_at) VALUES ($1, $2, $3)
       ON CONFLICT (family_id) DO UPDATE SET verified_at = excluded.verified_at WHERE identity.mfa_verified_sessions.user_id = excluded.user_id`,
      [familyId, userId, now],
    );
    return new Date(now.getTime() + MFA_SESSION_HOURS * 3_600_000);
  }
}

const invalidCode = () => new DomainError("MFA_INVALID_CODE", "Código incorrecto", 400);
