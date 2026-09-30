-- ADR 0175 (§7 Event/Location: city_id): ciudad del evento, derivada del lugar contextual ya calculado desde el punto
-- público generalizado. Columna generada: toda escritura de `place` la mantiene sin tocar el código de escritura.
ALTER TABLE event.events ADD COLUMN city_id text GENERATED ALWAYS AS (place->'city'->>'id') STORED;
CREATE INDEX events_city_idx ON event.events (city_id) WHERE city_id IS NOT NULL;

-- Proyección del feed "Siguiendo" (lugares seguidos): también por ciudad.
ALTER TABLE social.event_signals ADD COLUMN city_id text;
UPDATE social.event_signals s SET city_id = e.city_id FROM event.events e WHERE e.id = s.event_id;
CREATE INDEX event_signals_city_idx ON social.event_signals (city_id) WHERE city_id IS NOT NULL;
