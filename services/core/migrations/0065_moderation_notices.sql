-- Aviso push a la persona afectada por una acción de moderación o por la decisión de su apelación (ADR 0141).
-- Reutiliza la cola de avisos (horas de silencio, agrupación, historial). No tiene EVENT ni post: lleva a "mis avisos".
ALTER TABLE alert.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('NEW_EVENT','STATE_CHANGED','SEVERITY_UP','RESOLVED','MENTION','MODERATION'));
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_moderation_subject_check CHECK (kind <> 'MODERATION' OR (event_id IS NULL AND post_id IS NULL));
ALTER TABLE alert.notifications DROP CONSTRAINT notifications_match_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_match_check
  CHECK (match IN ('FOLLOWED_EVENT','SAVED_ZONE','NEAR_ME','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED','MENTIONED','MODERATION_NOTICE'));
