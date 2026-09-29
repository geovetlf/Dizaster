-- Foto de perfil y logo de negocio (Blueprint §7.3, RF-02, ADR 0119). La imagen es media propia ya saneada (sin EXIF,
-- re-codificada); se guarda el id y la URL de su miniatura pública para no consultar media en cada lectura.
ALTER TABLE social.profiles ADD COLUMN avatar_media_id uuid, ADD COLUMN avatar_url text;
ALTER TABLE social.business_profiles ADD COLUMN logo_media_id uuid, ADD COLUMN logo_url text;

-- Moderación: quitar la foto de un perfil o el logo de un negocio sin tocar la cuenta.
ALTER TABLE moderation.actions DROP CONSTRAINT actions_action_check;
ALTER TABLE moderation.actions ADD CONSTRAINT actions_action_check CHECK (action IN (
  'HIDE','REMOVE','RESTORE','LIMIT','WARN_USER','SUSPEND_USER','UNSUSPEND_USER','MARK_DISPUTED','DISMISS','APPROVE_MEDIA','MARK_GRAPHIC',
  'REMOVE_AVATAR'
));
