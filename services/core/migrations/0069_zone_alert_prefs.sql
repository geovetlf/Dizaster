-- Preferencias de alerta por zona guardada (ADR 0154, §7.3 SavedPlace.alert_prefs): gravedad mínima y categorías.
-- Lista vacía = todas las categorías. Un código raíz ("fire") cubre sus hijas.
ALTER TABLE alert.zones
  ADD COLUMN min_severity smallint NOT NULL DEFAULT 1 CHECK (min_severity BETWEEN 1 AND 5),
  ADD COLUMN categories   text[]   NOT NULL DEFAULT '{}' CHECK (cardinality(categories) <= 20);
