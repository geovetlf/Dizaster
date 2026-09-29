-- Miniaturas y hash perceptual (RF-10, ADR 0025). El hash vive en media.media.phash (16 hex); las bandas
-- permiten buscar fotos casi idénticas por índice.
ALTER TABLE media.media
  ADD COLUMN phash_bands  int[],
  ADD COLUMN duplicate_of uuid REFERENCES media.media(id),
  -- Casi idéntica a una foto de otra persona subida antes: moderación lo revisa (posible foto reciclada).
  ADD COLUMN reuse_suspected boolean NOT NULL DEFAULT false;
CREATE INDEX media_phash_bands_idx ON media.media USING gin (phash_bands) WHERE state = 'READY';
