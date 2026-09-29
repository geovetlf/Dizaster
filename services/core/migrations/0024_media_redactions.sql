-- Difuminado de rostros y matrículas (ADR 0042): recuadros normalizados que se aplican a las variantes públicas.
ALTER TABLE media.media ADD COLUMN redactions jsonb NOT NULL DEFAULT '[]'::jsonb;
