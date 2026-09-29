-- Editar mi perfil (ADR 0044): biografía corta y pública.
ALTER TABLE social.profiles ADD COLUMN bio text CHECK (bio IS NULL OR length(bio) BETWEEN 1 AND 160);
