-- ADR 0129: firma en el dispositivo de la evidencia offline. Solo la clave pública; la privada nunca sale del teléfono.
CREATE TABLE identity.device_signing_keys (
  id           uuid PRIMARY KEY,
  device_id    uuid NOT NULL REFERENCES identity.devices(id) ON DELETE CASCADE,
  public_key   text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Al registrar otra clave, la anterior sigue valiendo para lo capturado antes del reemplazo.
  replaced_at  timestamptz,
  UNIQUE (device_id, public_key)
);
CREATE UNIQUE INDEX device_signing_keys_current_idx ON identity.device_signing_keys (device_id) WHERE replaced_at IS NULL;

ALTER TABLE report.reports ADD COLUMN evidence_signature text NOT NULL DEFAULT 'ABSENT'
  CHECK (evidence_signature IN ('VALID','INVALID','ABSENT'));
