-- ADR 0133: re-procesar el crudo guardado queda registrado como una corrida más.
ALTER TABLE ingestion.runs DROP CONSTRAINT runs_trigger_check;
ALTER TABLE ingestion.runs ADD CONSTRAINT runs_trigger_check CHECK (trigger IN ('POLL','PUSH','REPROCESS'));
