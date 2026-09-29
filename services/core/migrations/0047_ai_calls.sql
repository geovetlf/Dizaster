-- Observabilidad del AI CORE (ADR 0110): una fila por intento con la IA encendida, SIN contenido (ni instrucción, ni
-- entrada, ni salida). Permite medir costo por capacidad, proveedor, modelo, persona, evento y periodo.
-- Retención 90 días; al borrar una cuenta se desvincula la persona.
CREATE TABLE cost.ai_calls (
  id             uuid PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  capability     text NOT NULL,
  provider       text NOT NULL,
  model          text,
  status         text NOT NULL CHECK (status IN ('OK','KILLED','NO_BUDGET','TIMEOUT','ERROR','UNSUPPORTED')),
  fallback       boolean NOT NULL,
  latency_ms     int NOT NULL CHECK (latency_ms >= 0),
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  estimated_usd  numeric(14,6) NOT NULL DEFAULT 0,
  usd            numeric(14,6) NOT NULL DEFAULT 0,
  subject_type   text,
  subject_id     uuid,
  actor_user_id  uuid
);
CREATE INDEX ai_calls_at_idx ON cost.ai_calls (at);
CREATE INDEX ai_calls_subject_idx ON cost.ai_calls (subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX ai_calls_actor_idx ON cost.ai_calls (actor_user_id) WHERE actor_user_id IS NOT NULL;
