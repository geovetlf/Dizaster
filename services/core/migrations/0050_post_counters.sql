-- Contadores sociales mantenidos al escribir (§7.4, ADR 0118): el feed deja de contar comentarios, compartidos y
-- reacciones con COUNT(*) por cada post leído. Los mantiene la base con triggers, así valen para todo camino de
-- escritura (publicar, borrar, moderar, borrar cuenta). Se recalcula el post afectado, nunca un +1/-1 que pueda derivar.
ALTER TABLE social.posts
  ADD COLUMN comment_count   int NOT NULL DEFAULT 0,
  ADD COLUMN share_count     int NOT NULL DEFAULT 0,
  ADD COLUMN reaction_counts jsonb NOT NULL DEFAULT '{}';

CREATE FUNCTION social.refresh_post_comments(pid uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE social.posts SET comment_count = (
    SELECT count(*) FROM social.comments c WHERE c.post_id = pid AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE'
  ) WHERE id = pid;
$$;
CREATE FUNCTION social.refresh_post_shares(pid uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE social.posts SET share_count = (
    SELECT count(*) FROM social.posts sp WHERE sp.shared_post_id = pid AND sp.deleted_at IS NULL AND sp.moderation_state = 'VISIBLE'
  ) WHERE id = pid;
$$;
CREATE FUNCTION social.refresh_post_reactions(pid uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE social.posts SET reaction_counts = coalesce((
    SELECT jsonb_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.reactions r WHERE r.post_id = pid GROUP BY r.kind) g
  ), '{}') WHERE id = pid;
$$;

CREATE FUNCTION social.comments_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM social.refresh_post_comments(OLD.post_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.post_id IS DISTINCT FROM OLD.post_id) THEN PERFORM social.refresh_post_comments(NEW.post_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER comments_counter AFTER INSERT OR DELETE OR UPDATE OF deleted_at, moderation_state, post_id ON social.comments
  FOR EACH ROW EXECUTE FUNCTION social.comments_counter();

CREATE FUNCTION social.reactions_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM social.refresh_post_reactions(OLD.post_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.post_id IS DISTINCT FROM OLD.post_id) THEN PERFORM social.refresh_post_reactions(NEW.post_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER reactions_counter AFTER INSERT OR DELETE OR UPDATE ON social.reactions
  FOR EACH ROW EXECUTE FUNCTION social.reactions_counter();

-- Compartidos: solo columnas que cambian el recuento (actualizar share_count no vuelve a disparar el trigger).
CREATE FUNCTION social.shares_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.shared_post_id IS NOT NULL THEN PERFORM social.refresh_post_shares(OLD.shared_post_id); END IF;
  IF TG_OP <> 'DELETE' AND NEW.shared_post_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.shared_post_id IS DISTINCT FROM OLD.shared_post_id) THEN PERFORM social.refresh_post_shares(NEW.shared_post_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER shares_counter AFTER INSERT OR DELETE OR UPDATE OF deleted_at, moderation_state, shared_post_id ON social.posts
  FOR EACH ROW EXECUTE FUNCTION social.shares_counter();

-- Relleno inicial.
UPDATE social.posts p SET
  comment_count = (SELECT count(*) FROM social.comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE'),
  share_count = (SELECT count(*) FROM social.posts sp WHERE sp.shared_post_id = p.id AND sp.deleted_at IS NULL AND sp.moderation_state = 'VISIBLE'),
  reaction_counts = coalesce((SELECT jsonb_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.reactions r WHERE r.post_id = p.id GROUP BY r.kind) g), '{}');
