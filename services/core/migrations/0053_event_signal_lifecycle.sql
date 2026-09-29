-- Ciclo de vida del evento en el orden del feed (§5.3, §6.2, ADR 0124): lo resuelto o archivado deja de empujar.
ALTER TABLE social.event_signals ADD COLUMN lifecycle text NOT NULL DEFAULT 'ACTIVE'
  CHECK (lifecycle IN ('ACTIVE','MONITORING','RESOLVED','ARCHIVED'));
UPDATE social.event_signals s SET lifecycle = e.status
  FROM event.events e WHERE e.id = s.event_id AND e.status IN ('MONITORING','RESOLVED','ARCHIVED');
