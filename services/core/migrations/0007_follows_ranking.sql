-- Red social: seguir (perfiles, eventos, lugares) y señales para ordenar el feed de forma determinista.

-- Seguir. target_type abierto (Blueprint §8.4): BUSINESS y TAG llegan después sin migrar datos.
CREATE TABLE social.follows (
  follower_profile_id uuid NOT NULL REFERENCES social.profiles(id),
  target_type         text NOT NULL CHECK (target_type IN ('PROFILE','BUSINESS','EVENT','TAG','PLACE')),
  target_id           text NOT NULL,        -- uuid del perfil/evento o id del área del índice geográfico ("PE:150122")
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_profile_id, target_type, target_id)
);
CREATE INDEX follows_target_idx ON social.follows (target_type, target_id);

-- Búsqueda de personas por handle o nombre visible.
CREATE INDEX profiles_handle_trgm_idx ON social.profiles USING gin (lower(handle) gin_trgm_ops);
CREATE INDEX profiles_name_trgm_idx ON social.profiles USING gin (lower(display_name) gin_trgm_ops);

-- Proyección (vía outbox) de lo que el feed necesita de cada EVENT para ordenar, sin leer el esquema event.
CREATE TABLE social.event_signals (
  event_id     uuid PRIMARY KEY,
  severity     smallint NOT NULL DEFAULT 1,
  public_state text NOT NULL DEFAULT 'UNVERIFIED',
  region_id    text,
  district_id  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_signals_region_idx ON social.event_signals (region_id);
CREATE INDEX event_signals_district_idx ON social.event_signals (district_id) WHERE district_id IS NOT NULL;

-- Relleno inicial para eventos que ya existían.
INSERT INTO social.event_signals (event_id, severity, public_state, region_id, district_id)
SELECT id, severity,
       CASE negative_state WHEN 'FALSE' THEN 'FALSE' WHEN 'DISPUTED' THEN 'DISPUTED' ELSE verification_level END,
       region_id, district_id
  FROM event.events
ON CONFLICT DO NOTHING;

CREATE INDEX posts_author_public_idx ON social.posts (author_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND visibility = 'PUBLIC' AND author_visibility = 'PUBLIC';
