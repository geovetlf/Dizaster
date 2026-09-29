-- Fusión y división manual de EVENTs por moderación (Blueprint §5.7, ADR 0034). Todo reversible y auditable.
ALTER TABLE event.merge_log
  ADD COLUMN moved_evidence uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN reverted_by    text,
  ADD COLUMN revert_reason  text;
CREATE INDEX merge_log_target_idx ON event.merge_log (target_event_id);
CREATE INDEX merge_log_merged_idx ON event.merge_log (merged_event_id);

CREATE TABLE event.split_log (
  id               uuid PRIMARY KEY,
  source_event_id  uuid NOT NULL REFERENCES event.events(id),
  new_event_id     uuid NOT NULL REFERENCES event.events(id),
  evidence_ids     uuid[] NOT NULL,
  reason           text NOT NULL,
  actor            text NOT NULL,
  at               timestamptz NOT NULL DEFAULT now()
);

-- Enlaces post→evento redirigidos por una fusión: recuerdan el evento original para poder revertirla.
ALTER TABLE social.post_event_links ADD COLUMN via_merge uuid;
