-- Compartir dentro de la app (ADR 0046): un post SHARE apunta al original.
ALTER TABLE social.posts ADD COLUMN shared_post_id uuid REFERENCES social.posts(id);
CREATE INDEX posts_shared_idx ON social.posts (shared_post_id) WHERE shared_post_id IS NOT NULL;
ALTER TABLE social.posts ADD CONSTRAINT posts_share_check CHECK ((kind = 'SHARE') = (shared_post_id IS NOT NULL));
