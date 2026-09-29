-- Varias cuentas en un mismo teléfono cuentan como una para corroborar (ADR 0068). Clave seudónima del teléfono:
-- HMAC del identificador de instalación del sistema (ya resumido en el teléfono). Nunca se guarda el valor original.
ALTER TABLE identity.devices ADD COLUMN hardware_key text;
CREATE INDEX devices_hardware_key_idx ON identity.devices (hardware_key, created_at) WHERE hardware_key IS NOT NULL;
