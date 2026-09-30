-- Altas y bajas de roles de personal, auditadas y solo de inserción (§13.1, ADR 0167).
CREATE TABLE identity.role_changes (
  id       uuid PRIMARY KEY,
  user_id  uuid NOT NULL,
  role     text NOT NULL,
  action   text NOT NULL CHECK (action IN ('GRANT','REVOKE')),
  actor    text NOT NULL,
  reason   text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_changes_at_idx ON identity.role_changes (at DESC);
CREATE TRIGGER role_changes_append_only BEFORE UPDATE OR DELETE ON identity.role_changes
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
