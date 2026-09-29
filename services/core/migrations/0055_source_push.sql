-- Ingestión por push (§9.2 "webhooks / feeds push", ADR 0128): una ejecución puede venir de un sondeo o de un envío
-- firmado de la propia fuente.
ALTER TABLE ingestion.runs ADD COLUMN trigger text NOT NULL DEFAULT 'POLL' CHECK (trigger IN ('POLL','PUSH'));
