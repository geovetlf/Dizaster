-- "¿Es el mismo evento?" (ADR 0156, §8.4 franja ambigua): la respuesta de quien reportó queda en la revisión.
ALTER TABLE event.dedup_reviews
  ADD COLUMN reporter_answer text CHECK (reporter_answer IN ('SAME','DIFFERENT')),
  ADD COLUMN answered_at     timestamptz;
