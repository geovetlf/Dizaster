-- Auditoría inmutable (§13.1, ADR 0232): los registros de cambios de estado, gravedad, división de eventos y estado
-- de fuentes pasan a ser de solo inserción, como los demás registros de auditoría (ADR 0048).
CREATE TRIGGER status_log_append_only BEFORE UPDATE OR DELETE ON event.status_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
CREATE TRIGGER severity_log_append_only BEFORE UPDATE OR DELETE ON event.severity_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
CREATE TRIGGER split_log_append_only BEFORE UPDATE OR DELETE ON event.split_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
CREATE TRIGGER source_status_log_append_only BEFORE UPDATE OR DELETE ON ingestion.source_status_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
