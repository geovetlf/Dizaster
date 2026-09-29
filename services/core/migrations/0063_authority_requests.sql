-- Registro auditado de requerimientos de autoridades (ADR 0139). Solo registro: no hay procedimiento de entrega de
-- datos. El requerimiento no se borra y solo cambia de estado; cada paso queda en un log de solo inserción.
CREATE TABLE moderation.authority_requests (
  id                  uuid PRIMARY KEY,
  authority           text NOT NULL,
  country             char(2) NOT NULL,
  jurisdiction        text,
  external_reference  text,
  type                text NOT NULL CHECK (type IN ('DATA_DISCLOSURE','DATA_PRESERVATION','CONTENT_REMOVAL','EMERGENCY_DISCLOSURE','OTHER')),
  channel             text NOT NULL CHECK (channel IN ('EMAIL','POSTAL','PORTAL','IN_PERSON','OTHER')),
  legal_basis         text,
  received_at         timestamptz NOT NULL,
  due_at              timestamptz,
  subject_refs        text[] NOT NULL DEFAULT '{}',
  summary             text NOT NULL,
  status              text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','IN_LEGAL_REVIEW','ANSWERED','REJECTED','WITHDRAWN')),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX authority_requests_status_idx ON moderation.authority_requests (status, received_at DESC);
CREATE INDEX authority_requests_received_idx ON moderation.authority_requests (received_at);

CREATE TABLE moderation.authority_request_log (
  id             uuid PRIMARY KEY,
  request_id     uuid NOT NULL REFERENCES moderation.authority_requests(id),
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  action         text NOT NULL CHECK (action IN ('CREATED','STATUS_CHANGED','NOTE_ADDED')),
  from_status    text,
  to_status      text,
  note           text
);
CREATE INDEX authority_request_log_request_idx ON moderation.authority_request_log (request_id, at);

CREATE TRIGGER authority_request_log_append_only BEFORE UPDATE OR DELETE ON moderation.authority_request_log
  FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();

-- El requerimiento en sí: nunca se borra; solo cambian estado y fecha de actualización.
CREATE FUNCTION moderation.authority_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'moderation.authority_requests es un registro de auditoría: no se borra';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'moderation.authority_requests: solo cambia el estado';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_request_guard BEFORE UPDATE OR DELETE ON moderation.authority_requests
  FOR EACH ROW EXECUTE FUNCTION moderation.authority_request_guard();
