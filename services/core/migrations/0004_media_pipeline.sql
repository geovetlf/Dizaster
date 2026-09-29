-- Media Engine V1: subida directa firmada, validación y saneamiento en el worker, retención de originales.
ALTER TABLE media.media
  ADD COLUMN upload_expires_at     timestamptz,
  ADD COLUMN rejection_reason      text,
  ADD COLUMN sanitized             text[] NOT NULL DEFAULT '{}',   -- metadatos retirados de la variante pública
  ADD COLUMN processed_at          timestamptz,
  ADD COLUMN original_deleted_at   timestamptz;

CREATE INDEX media_owner_created_idx ON media.media (owner_profile_id, created_at);
CREATE INDEX media_pending_idx ON media.media (upload_expires_at) WHERE state = 'PENDING_UPLOAD';
CREATE INDEX media_original_retention_idx ON media.media (processed_at) WHERE storage_key_original IS NOT NULL AND state = 'READY';

-- Todo rechazo queda explicado (auditoría).
ALTER TABLE media.media ADD CONSTRAINT media_rejected_has_reason CHECK (state <> 'REJECTED' OR rejection_reason IS NOT NULL);

-- Media adjunta a un post (el post de un reporte incluido). Referencia lógica a media.media: sin FK entre esquemas.
CREATE TABLE social.post_media (
  post_id   uuid NOT NULL REFERENCES social.posts(id),
  media_id  uuid NOT NULL,
  position  smallint NOT NULL,
  PRIMARY KEY (post_id, media_id),
  UNIQUE (media_id)                                   -- una media pertenece a un solo post
);
