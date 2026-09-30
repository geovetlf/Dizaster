-- Gravedad del evento recalculada desde su evidencia activa + corrección de moderación (ADR 0160).
ALTER TABLE event.evidence ADD COLUMN severity smallint CHECK (severity BETWEEN 1 AND 5);
ALTER TABLE event.events
  ADD COLUMN severity_override smallint CHECK (severity_override BETWEEN 1 AND 5),
  ADD COLUMN severity_override_by text,
  ADD COLUMN severity_override_reason text,
  ADD COLUMN severity_override_at timestamptz;

CREATE TABLE event.severity_log (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES event.events(id),
  from_severity smallint NOT NULL,
  to_severity smallint NOT NULL,
  override smallint,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX severity_log_event_idx ON event.severity_log (event_id, created_at DESC);

-- Evidencia de fuentes ya existente: su gravedad sale del ítem normalizado.
UPDATE event.evidence v SET severity = (x.normalized->>'severity')::smallint
  FROM ingestion.external_items x
 WHERE v.ref_id = x.id AND v.evidence_type IN ('EXTERNAL_ITEM','OFFICIAL_ITEM')
   AND x.normalized->>'severity' ~ '^[1-5]$';
