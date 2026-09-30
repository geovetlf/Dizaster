-- ADR 0172 (§6.2): quién originó cada evento de dominio y búsqueda por id de correlación.
ALTER TABLE platform.outbox ADD COLUMN actor text;
CREATE INDEX outbox_correlation_idx ON platform.outbox (correlation_id) WHERE correlation_id IS NOT NULL;
