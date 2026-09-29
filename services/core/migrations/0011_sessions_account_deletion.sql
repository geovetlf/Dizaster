-- Sesiones con refresh token rotatorio y detección de reutilización (ADR 0021).
-- Solo se guarda el hash del refresh token; una familia = una cadena de rotaciones desde un inicio de sesión.
CREATE TABLE identity.sessions (
  id             uuid PRIMARY KEY,
  family_id      uuid NOT NULL,
  user_id        uuid NOT NULL REFERENCES identity.users(id),
  device_id      uuid REFERENCES identity.devices(id),
  token_hash     text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  rotated_at     timestamptz,
  revoked_at     timestamptz,
  revoke_reason  text
);
CREATE INDEX sessions_family_idx ON identity.sessions (family_id);
CREATE INDEX sessions_user_idx ON identity.sessions (user_id) WHERE revoked_at IS NULL;

-- Borrado de cuenta (ADR 0021): el perfil queda anonimizado y fuera de búsquedas y enlaces.
ALTER TABLE social.profiles ADD COLUMN deleted_at timestamptz;
