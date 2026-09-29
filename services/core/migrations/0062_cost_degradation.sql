-- ADR 0138: degradación automática por costo fuera de IA. `auto` distingue lo que apagó la regla (y puede volver
-- sola) de lo que apagó una persona (solo vuelve a mano).
ALTER TABLE cost.kill_switches ADD COLUMN auto boolean NOT NULL DEFAULT false;
