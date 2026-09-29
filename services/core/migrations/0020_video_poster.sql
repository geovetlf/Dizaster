-- Póster de video generado en el teléfono (ADR 0032). El original del póster vive junto al del video
-- (misma clave + "_poster") y se borra al procesarlo: solo queda la variante pública re-codificada.
ALTER TABLE media.media
  ADD COLUMN poster_bytes  integer,
  ADD COLUMN poster_sha256 text;
