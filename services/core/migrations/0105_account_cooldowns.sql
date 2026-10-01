-- Espera mínima entre acciones caras de una misma cuenta, compartida entre réplicas (ADR 0290). La clave es el id
-- interno de la cuenta, nunca una IP. Cada fila dura lo que dura la espera y se borra después.
-- UNLOGGED: perder una espera en un reinicio solo permite repetir antes de tiempo, sin daño.
CREATE UNLOGGED TABLE platform.account_cooldowns (
  user_id  uuid NOT NULL,
  kind     text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{0,30}$'),
  until    timestamptz NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX account_cooldowns_until_idx ON platform.account_cooldowns (until);
