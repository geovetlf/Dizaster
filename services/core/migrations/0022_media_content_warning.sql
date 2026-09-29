-- Contenido sensible (Blueprint §13.3, ADR 0035): aviso "tocar para ver" y aprobación de media en categorías sensibles.
ALTER TABLE media.media ADD COLUMN content_warning text CHECK (content_warning IN ('GRAPHIC'));

ALTER TABLE moderation.actions DROP CONSTRAINT actions_action_check;
ALTER TABLE moderation.actions ADD CONSTRAINT actions_action_check CHECK (action IN (
  'HIDE','REMOVE','RESTORE','LIMIT','WARN_USER','SUSPEND_USER','UNSUSPEND_USER','MARK_DISPUTED','DISMISS','APPROVE_MEDIA','MARK_GRAPHIC'
));
