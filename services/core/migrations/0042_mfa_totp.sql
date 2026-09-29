-- ADR 0090: MFA TOTP para moderación y administración (Blueprint §13.1). El secreto se guarda cifrado con FIELD_KEYS;
-- los códigos de recuperación, solo como hash.
CREATE TABLE identity.mfa_totp (
  user_id       uuid PRIMARY KEY REFERENCES identity.users(id),
  secret_enc    text NOT NULL,
  confirmed_at  timestamptz,
  -- Último paso de 30 s usado: un mismo código no sirve dos veces.
  last_step     bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.mfa_recovery_codes (
  user_id    uuid NOT NULL REFERENCES identity.users(id),
  code_hash  text NOT NULL,
  used_at    timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
-- Inicio de sesión (familia de refresh tokens) verificado con el segundo factor.
CREATE TABLE identity.mfa_verified_sessions (
  family_id    uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES identity.users(id),
  verified_at  timestamptz NOT NULL
);
CREATE TABLE identity.mfa_failures (
  user_id  uuid NOT NULL,
  at       timestamptz NOT NULL
);
CREATE INDEX mfa_failures_idx ON identity.mfa_failures (user_id, at DESC);
