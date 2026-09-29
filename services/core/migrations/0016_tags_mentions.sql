-- Etiquetas y menciones (RF-02, ADR 0027). La etiqueta se guarda en forma canónica (minúsculas, sin tildes);
-- `display` es como se escribió la primera vez.
CREATE TABLE social.tags (
  id          uuid PRIMARY KEY,
  normalized  text NOT NULL UNIQUE CHECK (length(normalized) BETWEEN 2 AND 60),
  display     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_prefix_idx ON social.tags (normalized text_pattern_ops);

CREATE TABLE social.post_tags (
  post_id  uuid NOT NULL REFERENCES social.posts(id),
  tag_id   uuid NOT NULL REFERENCES social.tags(id),
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_tag_idx ON social.post_tags (tag_id, post_id);

-- Solo menciones a perfiles que existen. Si la persona mencionada bloqueó al autor, no se enlaza.
CREATE TABLE social.post_mentions (
  post_id     uuid NOT NULL REFERENCES social.posts(id),
  profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  PRIMARY KEY (post_id, profile_id)
);
CREATE INDEX post_mentions_profile_idx ON social.post_mentions (profile_id);
