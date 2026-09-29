-- Comentarios (ADR 0045): respuestas de un nivel y reacciones en comentarios.
ALTER TABLE social.comments ADD COLUMN parent_comment_id uuid REFERENCES social.comments(id);
CREATE INDEX comments_parent_idx ON social.comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

CREATE TABLE social.comment_reactions (
  comment_id  uuid NOT NULL REFERENCES social.comments(id),
  profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  kind        text NOT NULL CHECK (kind IN ('LIKE','SUPPORT','USEFUL')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, profile_id, kind)
);
