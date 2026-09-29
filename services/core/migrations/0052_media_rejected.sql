-- Media rechazada después del reporte (§6.2, ADR 0121): el reporte recuerda qué media adjuntó para revisar su
-- presencia sin leer el esquema social.
ALTER TABLE report.reports ADD COLUMN media_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE report.reports r SET media_ids = m.ids
  FROM (SELECT post_id, array_agg(media_id ORDER BY position) AS ids FROM social.post_media GROUP BY post_id) m
 WHERE m.post_id = r.post_id;
CREATE INDEX reports_media_ids_idx ON report.reports USING gin (media_ids);
