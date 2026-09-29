-- Área oficial por evidencia (ADR 0144): el área del evento se recalcula como la unión de las áreas de sus evidencias
-- activas, así fusión, reversión y división la dejan siempre al día (antes la reversión dejaba el área fusionada).
ALTER TABLE event.evidence ADD COLUMN area geography(MultiPolygon, 4326);
-- Eventos existentes: su área pasa a la evidencia externa u oficial activa más antigua.
UPDATE event.evidence ev SET area = e.affected_area
  FROM event.events e
 WHERE e.affected_area IS NOT NULL AND ev.id = (
   SELECT id FROM event.evidence x WHERE x.event_id = e.id AND x.status = 'ACTIVE' AND x.trust_tier <> 'CITIZEN'
    ORDER BY x.observed_at, x.id LIMIT 1);
