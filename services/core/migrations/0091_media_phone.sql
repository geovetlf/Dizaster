-- ADR 0207: el cupo de subidas se comparte entre las cuentas de un mismo teléfono (como los reportes, ADR 0131).
-- `phone_id` es el primer registro de dispositivo del teléfono (ADR 0068). Solo hace falta 24 h: la retención lo
-- vacía a los 2 días.
ALTER TABLE media.media ADD COLUMN phone_id uuid;
CREATE INDEX media_phone_recent_idx ON media.media (phone_id, created_at) WHERE phone_id IS NOT NULL;
