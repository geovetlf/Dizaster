-- Idiomas iniciales (Blueprint D-19): español, inglés, portugués y francés.
ALTER TABLE alert.preferences DROP CONSTRAINT preferences_lang_check;
ALTER TABLE alert.preferences ADD CONSTRAINT preferences_lang_check CHECK (lang IN ('es','en','pt','fr'));
