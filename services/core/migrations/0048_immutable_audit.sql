-- Auditoría inmutable (§13.1, ADR 0113): las transiciones de verificación y las acciones de moderación solo se
-- insertan. Del registro de fusiones solo cambia la reversión (una vez): lo demás queda tal cual.
CREATE FUNCTION platform.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es un registro de auditoría: solo se inserta', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END $$;

CREATE TRIGGER transitions_append_only BEFORE UPDATE OR DELETE ON verification.transitions
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
CREATE TRIGGER moderation_actions_append_only BEFORE UPDATE OR DELETE ON moderation.actions
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();

CREATE FUNCTION event.merge_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event.merge_log es un registro de auditoría: no se borra';
  END IF;
  IF OLD.reverted_at IS NOT NULL
     OR (to_jsonb(NEW) - 'reverted_at' - 'reverted_by' - 'revert_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'reverted_at' - 'reverted_by' - 'revert_reason') THEN
    RAISE EXCEPTION 'event.merge_log: solo se registra la reversión, una vez';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merge_log_guard BEFORE UPDATE OR DELETE ON event.merge_log
  FOR EACH ROW EXECUTE FUNCTION event.merge_log_guard();
