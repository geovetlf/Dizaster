-- ADR 0075: el crudo de cada respuesta de fuente se guarda comprimido en object storage para auditoría y
-- re-procesamiento (Blueprint §7.3, §7.4). La BD solo guarda la clave y el hash; se borra tras la retención.
ALTER TABLE ingestion.runs ADD COLUMN raw_ref text, ADD COLUMN raw_sha256 text;
CREATE INDEX runs_raw_ref_idx ON ingestion.runs (raw_ref) WHERE raw_ref IS NOT NULL;
CREATE INDEX external_items_raw_ref_idx ON ingestion.external_items (raw_ref) WHERE raw_ref IS NOT NULL;
