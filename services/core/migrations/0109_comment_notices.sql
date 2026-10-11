-- Avisos de comentarios y respuestas (decisión del propietario, ADR 0315 y 0320): apagados por defecto en V1.
ALTER TABLE alert.preferences
  ADD COLUMN comments boolean NOT NULL DEFAULT false,
  ADD COLUMN replies boolean NOT NULL DEFAULT false;

ALTER TABLE alert.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('NEW_EVENT','STATE_CHANGED','SEVERITY_UP','RESOLVED','MENTION','MODERATION','OFFICIAL_UPDATE','COMMENT'));
-- Una mención o un comentario llevan al post y nunca a un EVENT.
ALTER TABLE alert.alerts DROP CONSTRAINT alerts_subject_check;
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_subject_check
  CHECK ((kind IN ('MENTION','COMMENT')) = (post_id IS NOT NULL AND event_id IS NULL));

ALTER TABLE alert.notifications DROP CONSTRAINT notifications_match_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_match_check
  CHECK (match IN ('FOLLOWED_EVENT','SAVED_ZONE','NEAR_ME','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED','MENTIONED','MODERATION_NOTICE','REPORTED',
                   'COMMENTED','REPLIED'));
-- Límite diario por persona: cuenta sus avisos sociales de las últimas 24 horas.
CREATE INDEX notifications_social_idx ON alert.notifications (profile_id, created_at) WHERE match IN ('COMMENTED','REPLIED');
