-- Historial de cambios de configuración de administración (§13.1, §13.3, ADR 0219): verificación de negocios,
-- ámbitos institucionales, presupuestos, kill switches y retrasos de publicación. Motivo obligatorio y solo inserción.
CREATE TABLE platform.config_changes (
  id             uuid PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('BUSINESS_VERIFICATION','OFFICIAL_SCOPE','BUDGET','KILL_SWITCH','PUBLISH_DELAY')),
  target         text NOT NULL,
  previous       jsonb,
  next           jsonb NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 3)
);
CREATE INDEX config_changes_kind_idx ON platform.config_changes (kind, id DESC);
CREATE TRIGGER config_changes_append_only BEFORE UPDATE OR DELETE ON platform.config_changes
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
