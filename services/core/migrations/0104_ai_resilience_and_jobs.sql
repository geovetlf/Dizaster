-- AI CORE resiliente y enriquecimiento asíncrono (ADR 0280).
-- 1) Registro de llamadas: nuevos estados (límite de tasa, cortocircuito, modelo no registrado) y prompt versionado.
ALTER TABLE cost.ai_calls DROP CONSTRAINT IF EXISTS ai_calls_status_check;
ALTER TABLE cost.ai_calls ADD CONSTRAINT ai_calls_status_check
  CHECK (status IN ('OK','KILLED','NO_BUDGET','TIMEOUT','ERROR','UNSUPPORTED','RATE_LIMITED','CIRCUIT_OPEN','UNREGISTERED_MODEL'));
ALTER TABLE cost.ai_calls ADD COLUMN IF NOT EXISTS prompt_id text;
ALTER TABLE cost.ai_calls ADD COLUMN IF NOT EXISTS prompt_version int;

-- 2) Cola de pistas de verificación por IA: solo existe trabajo si la capacidad está encendida. Una fila por evento
--    (la última evidencia pide una nueva evaluación). Nunca bloquea reportes ni la verificación por reglas.
CREATE TABLE verification.ai_jobs (
  event_id      uuid PRIMARY KEY,
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED')),
  attempts      int NOT NULL DEFAULT 0,
  last_reason   text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_jobs_pending_idx ON verification.ai_jobs (requested_at) WHERE status = 'PENDING';

-- La sugerencia guarda con qué prompt se pidió.
ALTER TABLE verification.ai_suggestions ADD COLUMN IF NOT EXISTS prompt text;
