-- Push directo por plataforma: APNs (iOS) y FCM (Android). Un token pertenece a un único dispositivo.
ALTER TABLE identity.devices
  ADD COLUMN push_provider          text CHECK (push_provider IN ('APNS','FCM')),
  ADD COLUMN push_environment       text CHECK (push_environment IN ('development','production')),
  ADD COLUMN push_token_updated_at  timestamptz,
  ADD CONSTRAINT devices_push_provider_matches_platform CHECK (
    push_provider IS NULL
    OR (platform = 'IOS' AND push_provider = 'APNS')
    OR (platform = 'ANDROID' AND push_provider = 'FCM')
  ),
  ADD CONSTRAINT devices_push_token_complete CHECK ((push_token IS NULL) = (push_provider IS NULL));

CREATE UNIQUE INDEX devices_push_token_uq ON identity.devices (push_provider, push_token) WHERE push_token IS NOT NULL;
