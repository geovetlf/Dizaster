-- ADR 0255 (§5.3): el feed "Cerca" también encuentra posts ligados a un evento cercano aunque el post no tenga
-- punto propio. La proyección guarda solo el punto PÚBLICO (generalizado) del evento, nunca el preciso.
ALTER TABLE social.event_signals ADD COLUMN public_point geography(Point, 4326);
UPDATE social.event_signals s SET public_point = e.public_geom FROM event.events e WHERE e.id = s.event_id;
CREATE INDEX event_signals_point_idx ON social.event_signals USING gist (public_point);
