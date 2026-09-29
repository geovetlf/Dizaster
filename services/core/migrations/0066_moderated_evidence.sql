-- Reportes ocultos o retirados por moderación (ADR 0143): su evidencia queda MODERATED (deja de contar) y Restaurar la
-- devuelve a ACTIVE. `hidden_from` guarda el estado de publicación de un evento que se ocultó por quedarse sin
-- evidencia activa, para devolverlo igual si esa evidencia vuelve.
ALTER TABLE event.evidence DROP CONSTRAINT evidence_status_check;
ALTER TABLE event.evidence ADD CONSTRAINT evidence_status_check CHECK (status IN ('ACTIVE','DETACHED','MODERATED'));
ALTER TABLE event.events ADD COLUMN hidden_from text;
