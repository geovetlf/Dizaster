-- Hora de fin del evento (§7.3 Event.occurred_end, ADR 0140). La mantiene el mismo trigger que resolved_at, para
-- cubrir todas las rutas: al pasar a RESOLVED, si nadie fijó una hora de fin (la fuente oficial la da), se usa la
-- última actividad; al reactivarse, se borra. Archivar no la cambia.
CREATE OR REPLACE FUNCTION event.track_resolved_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'RESOLVED' AND OLD.status IS DISTINCT FROM 'RESOLVED' THEN
    NEW.resolved_at := now();
    NEW.occurred_end := least(coalesce(NEW.occurred_end, NEW.last_activity_at), now());
  ELSIF NEW.status IN ('ACTIVE', 'MONITORING') THEN
    NEW.resolved_at := NULL;
    NEW.occurred_end := NULL;
  END IF;
  RETURN NEW;
END $$;
UPDATE event.events SET occurred_end = least(last_activity_at, coalesce(resolved_at, now()))
 WHERE status IN ('RESOLVED', 'ARCHIVED') AND occurred_end IS NULL;
