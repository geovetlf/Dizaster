-- Zonas guardadas y última ubicación aproximada para alertas cercanas (Blueprint D-16, ADR 0022).
ALTER TABLE alert.preferences
  ADD COLUMN saved_zones boolean NOT NULL DEFAULT true,
  ADD COLUMN near_me     boolean NOT NULL DEFAULT false;

ALTER TABLE alert.notifications DROP CONSTRAINT notifications_match_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_match_check
  CHECK (match IN ('FOLLOWED_EVENT','SAVED_ZONE','NEAR_ME','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED'));

-- Centro = centro de la celda H3 r8 del punto elegido: la base nunca guarda la dirección exacta de nadie.
CREATE TABLE alert.zones (
  id          uuid PRIMARY KEY,
  profile_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('HOME','WORK','FAMILY','SCHOOL','OTHER')),
  name        text CHECK (length(name) <= 40),
  center      geography(Point, 4326) NOT NULL,
  radius_m    integer NOT NULL CHECK (radius_m BETWEEN 1000 AND 50000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_profile_idx ON alert.zones (profile_id);
CREATE INDEX zones_center_idx ON alert.zones USING gist (center);

-- Última ubicación aproximada (centro de celda H3 r7). Una fila por perfil; caduca a las 72 h.
CREATE TABLE alert.last_locations (
  profile_id  uuid PRIMARY KEY,
  center      geography(Point, 4326) NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX last_locations_center_idx ON alert.last_locations USING gist (center);
