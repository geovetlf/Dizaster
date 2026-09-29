-- ADR 0136: edición de posts durante 24 h. El historial lo ve solo moderación.
ALTER TABLE social.posts ADD COLUMN edited_at timestamptz;
CREATE TABLE social.post_edits (
  id                 uuid PRIMARY KEY,
  post_id            uuid NOT NULL REFERENCES social.posts(id),
  previous_text      text,
  editor_profile_id  uuid NOT NULL,
  edited_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_edits_post_idx ON social.post_edits (post_id, edited_at);
