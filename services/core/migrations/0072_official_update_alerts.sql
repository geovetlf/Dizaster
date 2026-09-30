-- Aviso push de actualizaciones oficiales a quienes siguen el evento (ADR 0157).
ALTER TABLE alert.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('NEW_EVENT','STATE_CHANGED','SEVERITY_UP','RESOLVED','MENTION','MODERATION','OFFICIAL_UPDATE'));
