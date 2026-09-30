-- ADR 0178 (§13.1 reintentos idempotentes): id generado en el cliente para posts y comentarios. Reintentar tras un
-- corte devuelve lo ya creado en vez de duplicarlo.
ALTER TABLE social.posts ADD COLUMN client_id uuid;
CREATE UNIQUE INDEX posts_client_id_uidx ON social.posts (author_id, client_id) WHERE client_id IS NOT NULL;
ALTER TABLE social.comments ADD COLUMN client_id uuid;
CREATE UNIQUE INDEX comments_client_id_uidx ON social.comments (author_profile_id, client_id) WHERE client_id IS NOT NULL;
