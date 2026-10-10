-- Índices para lecturas con sesión y de moderación (ADR 0310). Con volumen, estas consultas recorrían la tabla entera.
-- "¿Es el mismo evento?" de mis reportes: revisiones abiertas por evidencia.
CREATE INDEX dedup_reviews_evidence_idx ON event.dedup_reviews (evidence_id);
-- Cola y detalle de moderación: denuncias de cada caso (motivos y notas).
CREATE INDEX flags_case_idx ON moderation.flags (case_id, created_at DESC);
-- Registro de acceso a la presencia sin filtro: lo más reciente primero, con el mismo orden del cursor.
CREATE INDEX presence_access_time_idx ON report.presence_access_log (accessed_at DESC, id DESC);
