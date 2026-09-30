-- Acceso de moderación al original privado de una foto o video, con motivo y registro (§13.1, ADR 0168).
CREATE TABLE media.original_access_log (
  id             uuid PRIMARY KEY,
  media_id       uuid NOT NULL,
  actor_user_id  uuid NOT NULL,
  reason         text NOT NULL,
  case_id        uuid,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  accessed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX original_access_actor_idx ON media.original_access_log (actor_user_id, accessed_at DESC);
CREATE TRIGGER original_access_append_only BEFORE UPDATE OR DELETE ON media.original_access_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
