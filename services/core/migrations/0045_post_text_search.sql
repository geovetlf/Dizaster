-- Búsqueda de publicaciones por texto (ADR 0107): trigram sobre el texto en minúsculas, solo posts no borrados.
CREATE INDEX posts_text_trgm_idx ON social.posts USING gin (lower(text) gin_trgm_ops) WHERE deleted_at IS NULL AND text IS NOT NULL;
