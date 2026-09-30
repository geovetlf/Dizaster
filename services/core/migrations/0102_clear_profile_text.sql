-- ADR 0263: moderación puede vaciar la bio y devolver el nombre visible al handle.
ALTER TABLE moderation.actions DROP CONSTRAINT actions_action_check;
ALTER TABLE moderation.actions ADD CONSTRAINT actions_action_check CHECK (action IN (
  'HIDE','REMOVE','RESTORE','LIMIT','WARN_USER','SUSPEND_USER','UNSUSPEND_USER','MARK_DISPUTED','DISMISS','APPROVE_MEDIA','MARK_GRAPHIC',
  'REMOVE_AVATAR','CLEAR_PROFILE_TEXT'
));
