-- Salud de fuentes y retención de corridas con meses de historia (ADR 0322). Una fuente corre cada pocos minutos y
-- sus corridas se guardan 90 días: decenas de miles por fuente.
-- Último error de cada fuente en /v1/admin/sources: en una fuente sana, buscarlo por fecha recorría toda su historia.
CREATE INDEX runs_failed_idx ON ingestion.runs (source_id, started_at DESC) WHERE status = 'FAILED';
-- Retención diaria de corridas sin crudo (mismo predicado que la consulta): recorría la tabla entera.
CREATE INDEX runs_unarchived_started_idx ON ingestion.runs (started_at) WHERE raw_ref IS NULL;
