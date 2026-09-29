-- ADR 0099: retraso de publicación para categorías HIGHLY_SENSITIVE (§8.5).
-- Un EVENT ciudadano de una categoría con retraso nace DELAYED y pasa a PUBLISHED en publish_after.
ALTER TABLE event.events ADD COLUMN publish_after timestamptz;
ALTER TABLE event.events DROP CONSTRAINT events_publication_state_check;
ALTER TABLE event.events ADD CONSTRAINT events_publication_state_check
  CHECK (publication_state IN ('PUBLISHED','PENDING_CORROBORATION','DELAYED','HIDDEN'));
CREATE INDEX events_delayed_idx ON event.events (publish_after) WHERE publication_state = 'DELAYED';

-- El post del reporte también espera: solo su autor lo ve antes.
ALTER TABLE social.posts ADD COLUMN visible_after timestamptz;
