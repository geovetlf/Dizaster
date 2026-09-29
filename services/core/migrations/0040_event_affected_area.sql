-- Área oficial afectada de un EVENT (ADR 0087). Solo la aportan fuentes externas u oficiales (CAP <polygon>/<circle>
-- o geocódigos); nunca un reporte ciudadano. Sirve para avisar a las zonas guardadas y áreas seguidas que están dentro
-- del área aunque lejos del punto del evento.
ALTER TABLE event.events ADD COLUMN affected_area geography(MultiPolygon, 4326);
CREATE INDEX events_affected_area_idx ON event.events USING gist (affected_area) WHERE affected_area IS NOT NULL;
