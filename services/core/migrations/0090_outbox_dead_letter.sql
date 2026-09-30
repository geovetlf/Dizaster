-- ADR 0206: un evento interno que falla demasiadas veces pasa a cuarentena (no se reintenta solo, no cuenta como
-- atasco) hasta que operación lo reprocesa con `pnpm outbox replay`.
ALTER TABLE platform.outbox ADD COLUMN dead_at timestamptz;
DROP INDEX platform.outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON platform.outbox (lane, available_at) WHERE processed_at IS NULL AND dead_at IS NULL;
CREATE INDEX outbox_dead_idx ON platform.outbox (dead_at) WHERE dead_at IS NOT NULL AND processed_at IS NULL;
