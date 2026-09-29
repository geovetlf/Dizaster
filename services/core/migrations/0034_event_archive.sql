-- Archivado de eventos (ADR 0061, D-ARCHIVE): RESOLVED se mantiene visible N días y luego pasa a ARCHIVED.
-- resolved_at lo mantiene un trigger para cubrir todas las rutas (inactividad, moderación, fin de la fuente).
ALTER TABLE event.events ADD COLUMN resolved_at timestamptz;
UPDATE event.events SET resolved_at = updated_at WHERE status = 'RESOLVED';

CREATE FUNCTION event.track_resolved_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'RESOLVED' AND OLD.status IS DISTINCT FROM 'RESOLVED' THEN
    NEW.resolved_at := now();
  ELSIF NEW.status IN ('ACTIVE', 'MONITORING') THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_resolved_at BEFORE UPDATE OF status ON event.events
  FOR EACH ROW EXECUTE FUNCTION event.track_resolved_at();
CREATE INDEX events_resolved_idx ON event.events (resolved_at) WHERE status = 'RESOLVED';
