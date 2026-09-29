-- Fin de una alerta de fuente (ADR 0059): cancelación explícita (CAP Cancel) o expiración declarada por la fuente.
ALTER TABLE ingestion.external_items
  ADD COLUMN ends_at      timestamptz,
  ADD COLUMN withdrawn_at timestamptz;
CREATE INDEX external_items_ended_idx ON ingestion.external_items (coalesce(withdrawn_at, ends_at)) WHERE event_id IS NOT NULL;
