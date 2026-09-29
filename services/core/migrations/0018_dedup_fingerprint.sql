-- Huella para deduplicar EVENTs (Blueprint §8.4 sim_texto y sim_media, ADR 0030): palabras clave y hashes
-- perceptuales de las fotos ya asociadas, acotados en el código (50 y 20).
ALTER TABLE event.events
  ADD COLUMN keywords     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN media_hashes text[] NOT NULL DEFAULT '{}';
-- Encontrar el evento de una foto que termina de procesarse después del reporte.
CREATE INDEX timeline_media_ids_idx ON event.timeline USING gin ((payload->'mediaIds')) WHERE type = 'MEDIA_ADDED';
