-- Contadores sociales sin carrera (ADR 0345). Los triggers de 0050 recalculan el post afectado, pero con READ
-- COMMITTED el recuento de una escritura simultánea usa la foto tomada antes de esperar el bloqueo de la fila del post:
-- dos «me gusta» o un «me gusta» y un «ya no» a la vez dejaban `reaction_counts` (y `comment_count`, `share_count`)
-- desfasado hasta la siguiente escritura. Ahora se toma primero el bloqueo de la fila (el mismo modo que ya tomaba el
-- UPDATE, FOR NO KEY UPDATE: no choca con las claves foráneas que apuntan al post) y el recuento va en una sentencia
-- posterior, con una foto que ya incluye lo confirmado por quien tenía el bloqueo. Misma semántica: recalcular, nunca
-- +1/-1.
CREATE OR REPLACE FUNCTION social.refresh_post_comments(pid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM social.posts WHERE id = pid FOR NO KEY UPDATE;
  UPDATE social.posts SET comment_count = (
    SELECT count(*) FROM social.comments c WHERE c.post_id = pid AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE'
  ) WHERE id = pid;
END $$;

CREATE OR REPLACE FUNCTION social.refresh_post_shares(pid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM social.posts WHERE id = pid FOR NO KEY UPDATE;
  UPDATE social.posts SET share_count = (
    SELECT count(*) FROM social.posts sp WHERE sp.shared_post_id = pid AND sp.deleted_at IS NULL AND sp.moderation_state = 'VISIBLE'
  ) WHERE id = pid;
END $$;

CREATE OR REPLACE FUNCTION social.refresh_post_reactions(pid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM social.posts WHERE id = pid FOR NO KEY UPDATE;
  UPDATE social.posts SET reaction_counts = coalesce((
    SELECT jsonb_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.reactions r WHERE r.post_id = pid GROUP BY r.kind) g
  ), '{}') WHERE id = pid;
END $$;

-- Corrige lo que una carrera anterior haya dejado desfasado. Solo reescribe los posts cuyo contador no cuadra.
WITH fresh AS (
  SELECT p.id,
         (SELECT count(*) FROM social.comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE')::int AS comments,
         (SELECT count(*) FROM social.posts sp WHERE sp.shared_post_id = p.id AND sp.deleted_at IS NULL AND sp.moderation_state = 'VISIBLE')::int AS shares,
         coalesce((SELECT jsonb_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.reactions r WHERE r.post_id = p.id GROUP BY r.kind) g), '{}') AS reactions
    FROM social.posts p
)
UPDATE social.posts p SET comment_count = f.comments, share_count = f.shares, reaction_counts = f.reactions
  FROM fresh f
 WHERE f.id = p.id AND (p.comment_count, p.share_count, p.reaction_counts) IS DISTINCT FROM (f.comments, f.shares, f.reactions);
