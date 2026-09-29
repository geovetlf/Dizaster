-- Edad mínima (D-13, ADR 0049). Se guarda solo que la persona declaró tener la edad mínima exigida y cuándo;
-- nunca la fecha de nacimiento.
ALTER TABLE identity.users ADD COLUMN age_confirmed_min smallint;
ALTER TABLE identity.users ADD COLUMN age_confirmed_at timestamptz;
