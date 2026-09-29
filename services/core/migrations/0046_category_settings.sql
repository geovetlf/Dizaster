-- Ajustes de categoría que administración cambia sin desplegar (ADR 0109). Hoy: minutos de retraso de publicación.
-- Sin fila, vale el del catálogo versionado en /data.
CREATE TABLE event.category_settings (
  category_code          text PRIMARY KEY,
  publish_delay_minutes  int NOT NULL CHECK (publish_delay_minutes BETWEEN 0 AND 1440),
  updated_by             uuid NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
