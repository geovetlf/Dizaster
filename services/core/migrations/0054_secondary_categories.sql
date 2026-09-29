-- Categorías secundarias del evento (§7.3 secondary_categories[], ADR 0125): cada evidencia recuerda la categoría
-- con que llegó; el evento guarda las distintas de la principal que aportan sus evidencias activas.
ALTER TABLE event.evidence ADD COLUMN category_code text;
UPDATE event.evidence v SET category_code = r.category_code
  FROM report.reports r WHERE v.evidence_type = 'CITIZEN_REPORT' AND r.id = v.ref_id;
UPDATE event.evidence v SET category_code = x.normalized->>'categoryCode'
  FROM ingestion.external_items x WHERE v.evidence_type IN ('EXTERNAL_ITEM','OFFICIAL_ITEM') AND x.id = v.ref_id;

ALTER TABLE event.events ADD COLUMN secondary_categories text[] NOT NULL DEFAULT '{}';
UPDATE event.events e SET secondary_categories = s.cats
  FROM (SELECT v.event_id, array_agg(DISTINCT v.category_code ORDER BY v.category_code) AS cats
          FROM event.evidence v JOIN event.events ev ON ev.id = v.event_id
         WHERE v.status = 'ACTIVE' AND v.assertion = 'OCCURRING' AND v.category_code IS NOT NULL AND v.category_code <> ev.category_code
         GROUP BY v.event_id) s
 WHERE s.event_id = e.id;
CREATE INDEX events_secondary_categories_idx ON event.events USING gin (secondary_categories);
