-- ADR 0177: reintento de avisos push con error temporal (429, 5xx, sin red).
ALTER TABLE alert.notifications
  ADD COLUMN attempts        smallint NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz;
