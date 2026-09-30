-- ADR 0181 (§7 ReportPresenceEvidence.media_capture_proofs): qué media de cámara acompañó al reporte y con qué horas.
-- Vive en la evidencia de presencia: misma privacidad y misma retención (D-06). Sin ubicación de la captura.
ALTER TABLE report.presence_evidence ADD COLUMN media_capture_proofs jsonb NOT NULL DEFAULT '[]';
