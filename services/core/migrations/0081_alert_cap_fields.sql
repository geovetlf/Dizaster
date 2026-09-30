-- ADR 0174 (§7 Alert, compatible con CAP): origen, vencimiento y referencia a la alerta CAP de la fuente oficial.
ALTER TABLE alert.alerts
  ADD COLUMN origin     text NOT NULL DEFAULT 'SYSTEM' CHECK (origin IN ('OFFICIAL','SYSTEM')),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN cap_ref    text;
UPDATE alert.alerts SET origin = 'OFFICIAL' WHERE public_state = 'OFFICIALLY_CONFIRMED' OR kind = 'OFFICIAL_UPDATE';

-- Un aviso que no llegó a salir antes de vencer ya no se envía (horas de silencio, cola atrasada).
ALTER TABLE alert.notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE alert.notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('PENDING','SENT','GROUPED','SILENT_RATE_LIMIT','SILENT_QUIET_HOURS','NO_DEVICE','FAILED','EXPIRED'));
