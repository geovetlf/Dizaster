-- Anti-spam coordinado y visibilidad por reputación (Blueprint §13.3, ADR 0031).
-- Huella del texto normalizado: el mismo mensaje pegado por varias cuentas en pocas horas va a revisión humana.
ALTER TABLE social.posts ADD COLUMN text_hash text;
CREATE INDEX posts_text_hash_idx ON social.posts (text_hash, created_at) WHERE text_hash IS NOT NULL;
-- Proyección de la reputación: solo "baja o no". El feed la usa para ordenar; nunca se muestra.
ALTER TABLE social.profiles ADD COLUMN low_trust boolean NOT NULL DEFAULT false;
CREATE TABLE trust.standing (
  user_id    uuid PRIMARY KEY,
  low        boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX standing_low_idx ON trust.standing (user_id) WHERE low;
