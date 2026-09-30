-- ADR 0223: quien reportó un evento recibe los avisos de cambio de ese evento (match REPORTED).
ALTER TABLE alert.notifications DROP CONSTRAINT IF EXISTS notifications_match_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_match_check
  CHECK (match IN ('FOLLOWED_EVENT','SAVED_ZONE','NEAR_ME','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED','MENTIONED','MODERATION_NOTICE','REPORTED'));
