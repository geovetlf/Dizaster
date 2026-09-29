-- ADR 0076: fusión automática de duplicados y cola de posibles duplicados entre EVENTs (Blueprint §5.7, §8.4).
CREATE TABLE event.duplicate_candidates (
  id           uuid PRIMARY KEY,
  event_a      uuid NOT NULL REFERENCES event.events(id),
  event_b      uuid NOT NULL REFERENCES event.events(id),
  score        real NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('AMBIGUOUS_SCORE','BOTH_SOURCED')),
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MERGED','DISMISSED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text,
  CHECK (event_a < event_b),
  UNIQUE (event_a, event_b)
);
CREATE INDEX duplicate_candidates_open_idx ON event.duplicate_candidates (created_at) WHERE status = 'OPEN';
CREATE INDEX merge_log_actor_idx ON event.merge_log (at) WHERE actor LIKE 'RULE:%';
