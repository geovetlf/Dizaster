-- Purga diaria de sesiones caducadas (ADR 0269): el job busca por fecha de caducidad sin recorrer la tabla.
CREATE INDEX sessions_expires_idx ON identity.sessions (expires_at);
