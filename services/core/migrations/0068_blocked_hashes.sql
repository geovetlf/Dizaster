-- Lista propia de hashes de contenido retirado por moderación (§5.12, ADR 0145). Solo hashes (SHA-256 exacto y hash
-- perceptual), nunca la imagen. Una subida que coincide queda HELD (no se muestra) y va a la cola de moderación;
-- nunca se rechaza sola (decisión del propietario).
CREATE TABLE media.blocked_hashes (
  media_id     uuid PRIMARY KEY,
  sha256       text NOT NULL,
  phash        text,
  phash_bands  int[],
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blocked_hashes_sha_idx ON media.blocked_hashes (sha256);
CREATE INDEX blocked_hashes_bands_idx ON media.blocked_hashes USING gin (phash_bands);

ALTER TABLE media.media DROP CONSTRAINT media_moderation_state_check;
ALTER TABLE media.media ADD CONSTRAINT media_moderation_state_check CHECK (moderation_state IN ('PENDING','APPROVED','LIMITED','REMOVED','HELD'));
ALTER TABLE media.media ADD COLUMN blocked_match_of uuid;
