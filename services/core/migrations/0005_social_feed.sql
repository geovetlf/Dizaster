-- Red social (primer corte): tema del post, reacciones y comentarios. Feed por recientes y por cercanía.
ALTER TABLE social.posts ADD COLUMN category_code text;           -- tema del post (el de su reporte, si lo tiene)
CREATE INDEX posts_feed_idx ON social.posts (created_at DESC, id DESC) WHERE deleted_at IS NULL AND visibility = 'PUBLIC';
CREATE INDEX posts_public_point_idx ON social.posts USING gist (public_point) WHERE public_point IS NOT NULL;

CREATE TABLE social.reactions (
  post_id     uuid NOT NULL REFERENCES social.posts(id),
  profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  kind        text NOT NULL DEFAULT 'LIKE' CHECK (kind IN ('LIKE')),   -- ampliable (útil, preocupante…) sin migrar datos
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id, kind)
);

CREATE TABLE social.comments (
  id                 uuid PRIMARY KEY,
  post_id            uuid NOT NULL REFERENCES social.posts(id),
  author_profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  text               text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  moderation_state   text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_state IN ('VISIBLE','HIDDEN','REMOVED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX comments_post_idx ON social.comments (post_id, created_at);

-- Tipo de cada media adjunta (lo informa el Media Engine al adjuntar): permite la pestaña de videos sin
-- consultar otro esquema.
ALTER TABLE social.post_media ADD COLUMN kind text NOT NULL DEFAULT 'IMAGE' CHECK (kind IN ('IMAGE','VIDEO_RECORDED'));
ALTER TABLE social.post_media ALTER COLUMN kind DROP DEFAULT;
