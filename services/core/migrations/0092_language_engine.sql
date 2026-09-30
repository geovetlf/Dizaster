-- Language Engine (ADR 0216): los idiomas soportados viven en el registro de la app/servidor (@dizaster/contracts),
-- no en la base. La base solo exige un código de idioma bien formado; agregar un idioma ya no requiere migración.
-- Un código que la versión en curso no conoce se lee como el respaldo global (es).
ALTER TABLE alert.preferences DROP CONSTRAINT IF EXISTS preferences_lang_check;
ALTER TABLE alert.preferences ADD CONSTRAINT preferences_lang_format CHECK (lang ~ '^[a-z]{2,3}$');
