-- Suspensiones escalonadas (decisión del propietario, ADR 0315 y 0319): 24 horas, 7 días o permanente.
-- Una cuenta SUSPENDED con suspended_until NULL está suspendida sin plazo: así quedan las suspensiones anteriores.
ALTER TABLE identity.users ADD COLUMN suspended_until timestamptz;
CREATE INDEX users_suspension_end_idx ON identity.users (suspended_until) WHERE status = 'SUSPENDED' AND suspended_until IS NOT NULL;

-- El registro de acciones (solo se inserta, ADR 0113) guarda la duración pedida y el fin efectivo de la suspensión.
ALTER TABLE moderation.actions
  ADD COLUMN suspension text CHECK (suspension IN ('HOURS_24', 'DAYS_7', 'PERMANENT')),
  ADD COLUMN suspended_until timestamptz,
  ADD CONSTRAINT actions_suspension_only_on_suspend CHECK (suspension IS NULL OR action = 'SUSPEND_USER');
CREATE INDEX actions_affected_suspend_idx ON moderation.actions (affected_user_id, created_at DESC) WHERE action = 'SUSPEND_USER';
