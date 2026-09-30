-- Detalles del modelo §7.3 (ADR 0155).

-- Ítem externo que no se pudo procesar: queda en ERROR con el motivo (sin el crudo, que está en object storage).
ALTER TABLE ingestion.external_items ADD COLUMN error text CHECK (length(error) <= 500);

-- Compartidos fuera de la app (Share target = EXTERNAL). Uno por persona y post: cuenta personas, no toques.
CREATE TABLE social.external_shares (
  post_id     uuid NOT NULL REFERENCES social.posts(id),
  profile_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id)
);
CREATE INDEX external_shares_profile_idx ON social.external_shares (profile_id);
ALTER TABLE social.posts ADD COLUMN external_share_count int NOT NULL DEFAULT 0;
