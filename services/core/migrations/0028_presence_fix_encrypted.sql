-- Ubicación precisa del dispositivo cifrada por columna (ADR 0048). La columna en claro queda solo para filas
-- antiguas: el worker las cifra y las vacía; se retirará cuando no quede ninguna.
ALTER TABLE report.presence_evidence ADD COLUMN device_fix_enc text;
