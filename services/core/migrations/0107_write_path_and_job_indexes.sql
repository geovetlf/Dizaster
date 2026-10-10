-- Índices del camino de un reporte y de los trabajos de mantenimiento (ADR 0311). Con volumen, estas consultas
-- recorrían la tabla entera en cada reporte, o en cada pasada del trabajo.
-- Cupo de reportes por teléfono y señales de manipulación de sus dispositivos (por hora, por día, 30 días).
CREATE INDEX reports_device_time_idx ON report.reports (device_id, received_at DESC) WHERE device_id IS NOT NULL;
-- Eventos absorbidos por una fusión (historial de avisos que hereda el destino).
CREATE INDEX events_merged_into_idx ON event.events (merged_into_id) WHERE merged_into_id IS NOT NULL;
-- Cifrado diario de ubicaciones precisas antiguas en claro: casi siempre no queda ninguna.
CREATE INDEX presence_legacy_fix_idx ON report.presence_evidence (report_id) WHERE device_fix IS NOT NULL;
-- Retención diaria de ubicaciones aproximadas y de avisos ya entregados.
CREATE INDEX last_locations_seen_idx ON alert.last_locations (seen_at);
CREATE INDEX notifications_created_idx ON alert.notifications (created_at) WHERE status <> 'PENDING';
