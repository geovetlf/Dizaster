-- Inicio de sesión por correo con código (§5.1, D-11, ADR 0170). No se guarda el correo: solo su HMAC.
CREATE TABLE identity.email_challenges (
  id           uuid PRIMARY KEY,
  email_key    text NOT NULL,
  code_hash    text NOT NULL,
  ip_key       text,
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_challenges_email_idx ON identity.email_challenges (email_key, created_at DESC);
CREATE INDEX email_challenges_ip_idx ON identity.email_challenges (ip_key, created_at DESC);
