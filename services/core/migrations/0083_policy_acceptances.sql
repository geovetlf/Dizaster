-- ADR 0176: aceptación versionada de términos y políticas. Solo inserción: una fila por aceptación.
CREATE TABLE identity.policy_acceptances (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id),
  kind        text NOT NULL CHECK (kind IN ('TERMS','PRIVACY','COMMUNITY_GUIDELINES')),
  version     text NOT NULL,
  platform    text,
  app_version text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, version)
);
-- Prueba de lo aceptado: no se edita ni se borra. Al borrar la cuenta queda solo el id interno (decisión legal
-- pendiente sobre si debe borrarse también).
CREATE TRIGGER policy_acceptances_append_only BEFORE UPDATE OR DELETE ON identity.policy_acceptances
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
