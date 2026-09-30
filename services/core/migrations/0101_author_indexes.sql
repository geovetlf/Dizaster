-- ADR 0259 (§7.4): el cupo de comentarios por minuto, el borrado de cuenta y la exportación filtran por autor.
-- Sin estos índices cada comentario recorría toda la tabla. (Menciones y compartidos externos ya tenían el suyo.)
CREATE INDEX comments_author_time_idx ON social.comments (author_profile_id, created_at DESC);
CREATE INDEX reactions_profile_idx ON social.reactions (profile_id);
CREATE INDEX comment_reactions_profile_idx ON social.comment_reactions (profile_id);
