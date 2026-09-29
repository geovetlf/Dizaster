-- Aviso push cuando alguien te menciona (D-MENTION, ADR 0063). Reutiliza la cola de avisos: horas de silencio,
-- límite por hora, agrupación e historial valen igual que para los EVENTs.
ALTER TABLE alert.alerts ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE alert.alerts ALTER COLUMN category_code DROP NOT NULL;
ALTER TABLE alert.alerts ALTER COLUMN severity DROP NOT NULL;
ALTER TABLE alert.alerts ALTER COLUMN public_state DROP NOT NULL;
-- post_id: el post que menciona. actor_profile_id: quien lo escribió, solo para el anti-spam; nunca sale por la API
-- (un post seudónimo no revela a su autor en el aviso).
ALTER TABLE alert.alerts ADD COLUMN post_id uuid, ADD COLUMN actor_profile_id uuid;
ALTER TABLE alert.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('NEW_EVENT','STATE_CHANGED','SEVERITY_UP','RESOLVED','MENTION'));
ALTER TABLE alert.alerts ADD CONSTRAINT alerts_subject_check CHECK ((kind = 'MENTION') = (post_id IS NOT NULL AND event_id IS NULL));
CREATE INDEX alerts_actor_idx ON alert.alerts (actor_profile_id, created_at) WHERE actor_profile_id IS NOT NULL;

ALTER TABLE alert.notifications DROP CONSTRAINT notifications_match_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_match_check
  CHECK (match IN ('FOLLOWED_EVENT','SAVED_ZONE','NEAR_ME','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED','MENTIONED'));

ALTER TABLE alert.preferences ADD COLUMN mentions boolean NOT NULL DEFAULT true;
