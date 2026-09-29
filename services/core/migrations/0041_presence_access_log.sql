-- ADR 0089: acceso auditado a la evidencia de presencia (Blueprint §7.3, §13.1). Cada consulta de moderación queda
-- registrada con quién, cuándo, qué reporte y por qué. Solo se inserta: ni se edita ni se borra.
CREATE TABLE report.presence_access_log (
  id             uuid PRIMARY KEY,
  report_id      uuid NOT NULL REFERENCES report.reports(id),
  actor_user_id  uuid NOT NULL,
  reason         text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  case_id        uuid,
  precise_shown  boolean NOT NULL,
  accessed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presence_access_report_idx ON report.presence_access_log (report_id, accessed_at DESC);
CREATE INDEX presence_access_actor_idx ON report.presence_access_log (actor_user_id, accessed_at DESC);

CREATE FUNCTION report.presence_access_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'presence_access_log es solo de inserción';
END $$;
CREATE TRIGGER presence_access_log_no_update BEFORE UPDATE OR DELETE ON report.presence_access_log
  FOR EACH ROW EXECUTE FUNCTION report.presence_access_log_immutable();
