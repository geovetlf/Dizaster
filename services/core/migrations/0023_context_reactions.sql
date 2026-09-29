-- Reacciones de contexto (ADR 0040): además de "me gusta", apoyo, útil y "yo también lo vi".
-- Son señales sociales: nunca cuentan como evidencia de verificación.
ALTER TABLE social.reactions DROP CONSTRAINT reactions_kind_check;
ALTER TABLE social.reactions ADD CONSTRAINT reactions_kind_check CHECK (kind IN ('LIKE','SUPPORT','USEFUL','SEEN_TOO'));
