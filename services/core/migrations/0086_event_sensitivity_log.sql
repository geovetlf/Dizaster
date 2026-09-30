-- ADR 0179 (§7 flags SENSITIVE, Anexo A.5): moderación puede subir la sensibilidad de un evento por su contexto.
-- Solo sube: bajar expondría más de lo que ya se generalizó. Registro de solo inserción.
CREATE TABLE event.sensitivity_log (
  id         uuid PRIMARY KEY,
  event_id   uuid NOT NULL REFERENCES event.events(id),
  from_level text NOT NULL,
  to_level   text NOT NULL,
  reason     text NOT NULL,
  actor      uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensitivity_log_event_idx ON event.sensitivity_log (event_id, created_at);
CREATE TRIGGER sensitivity_log_append_only BEFORE UPDATE OR DELETE ON event.sensitivity_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
