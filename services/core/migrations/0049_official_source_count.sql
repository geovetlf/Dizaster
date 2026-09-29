-- Fuentes oficiales por separado en la ficha (§10.1, ADR 0117): "12 reportes · 2 fuentes externas · 1 oficial".
-- source_count sigue siendo el total de fuentes no ciudadanas.
ALTER TABLE event.events ADD COLUMN official_source_count int NOT NULL DEFAULT 0;
UPDATE event.events e SET official_source_count = x.n
  FROM (SELECT event_id, count(*)::int AS n FROM event.evidence
         WHERE status = 'ACTIVE' AND assertion = 'OCCURRING' AND trust_tier = 'OFFICIAL' GROUP BY event_id) x
 WHERE x.event_id = e.id;
