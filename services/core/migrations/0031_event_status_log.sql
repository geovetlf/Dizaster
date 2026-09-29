-- Cambio manual del ciclo de vida de un EVENT por moderación (ADR 0053). Auditable: quién, cuándo, de qué a qué y por qué.
CREATE TABLE event.status_log (
  id           uuid PRIMARY KEY,
  event_id     uuid NOT NULL REFERENCES event.events(id),
  from_status  text NOT NULL,
  to_status    text NOT NULL,
  reason       text NOT NULL,
  actor        text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_log_event_idx ON event.status_log (event_id, at DESC);
