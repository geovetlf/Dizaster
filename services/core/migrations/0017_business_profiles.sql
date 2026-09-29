-- Perfiles de negocio (RF-02, D-04, ADR 0028). La tabla existía desde 0001 sin uso; se completa aquí.
ALTER TABLE social.business_profiles
  ADD COLUMN description      text CHECK (length(description) <= 500),
  ADD COLUMN address_public   text CHECK (length(address_public) <= 200),
  ADD COLUMN contact_phone    text CHECK (length(contact_phone) <= 30),
  ADD COLUMN contact_url      text CHECK (contact_url ~ '^https://'),
  ADD COLUMN moderation_state text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_state IN ('VISIBLE','REMOVED')),
  ADD COLUMN updated_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_at       timestamptz;
UPDATE social.business_profiles SET category = 'other' WHERE category IS NULL;
ALTER TABLE social.business_profiles ALTER COLUMN category SET NOT NULL;
-- business_handle_idx (lower(handle), único) existe desde 0001.
CREATE INDEX business_owner_idx ON social.business_profiles (owner_user_id) WHERE deleted_at IS NULL;
-- El handle de un negocio no puede coincidir con el de una persona (se comprueba al crear; aquí el índice
-- equivalente para personas, que la búsqueda por handle ya usa).
CREATE INDEX IF NOT EXISTS profiles_handle_lower_idx ON social.profiles (lower(handle));

-- Moderación: los perfiles de negocio también se pueden denunciar.
ALTER TABLE moderation.cases DROP CONSTRAINT IF EXISTS cases_target_type_check;
ALTER TABLE moderation.cases ADD CONSTRAINT cases_target_type_check CHECK (target_type IN ('POST','COMMENT','EVENT','PROFILE','BUSINESS'));
