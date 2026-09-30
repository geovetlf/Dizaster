-- ADR 0184 (decisión del propietario, 2026-09-30): al borrar la cuenta se conservan las aceptaciones de términos
-- de forma mínima: id interno, documento, versión y fecha. Plataforma y versión de la app se vacían.
-- La tabla sigue siendo de solo inserción: la única modificación permitida es ese vaciado.
CREATE FUNCTION identity.policy_acceptances_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.kind = OLD.kind
     AND NEW.version = OLD.version AND NEW.accepted_at = OLD.accepted_at
     AND NEW.platform IS NULL AND NEW.app_version IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'identity.policy_acceptances solo se inserta (se permite vaciar plataforma y versión)';
END $$;

DROP TRIGGER policy_acceptances_append_only ON identity.policy_acceptances;
CREATE TRIGGER policy_acceptances_append_only BEFORE UPDATE OR DELETE ON identity.policy_acceptances
  FOR EACH ROW EXECUTE FUNCTION identity.policy_acceptances_guard();
