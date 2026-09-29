-- Cost Optimization Layer persistido (ADR 0019): uso medido por módulo, gasto real contra presupuestos,
-- avisos de umbral (50/80/100 %) y kill switches remotos.
CREATE SCHEMA IF NOT EXISTS cost;

-- Uso medido, agregado por día. Los procesos acumulan en memoria y vuelcan en lote: una fila por
-- (día, módulo, métrica, proveedor), nunca una fila por petición.
CREATE TABLE cost.usage_daily (
  day       date NOT NULL,
  module    text NOT NULL,
  metric    text NOT NULL,
  provider  text NOT NULL DEFAULT '',
  units     double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (day, module, metric, provider)
);

-- Gasto real de funciones de pago (IA, SMS, traducción...). Solo se escribe después de CostGuard.check.
CREATE TABLE cost.spend_daily (
  day       date NOT NULL,
  key       text NOT NULL,
  provider  text NOT NULL DEFAULT '',
  units     double precision NOT NULL DEFAULT 0,
  usd       numeric(14,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key, provider)
);

CREATE TABLE cost.budgets (
  key         text PRIMARY KEY,
  period      text NOT NULL CHECK (period IN ('DAILY','MONTHLY')),
  limit_usd   numeric(14,4) NOT NULL CHECK (limit_usd >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Cada umbral se avisa una sola vez por periodo.
CREATE TABLE cost.threshold_alerts (
  key           text NOT NULL,
  period_start  date NOT NULL,
  threshold     int NOT NULL CHECK (threshold IN (50, 80, 100)),
  reached_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, period_start, threshold)
);

CREATE TABLE cost.kill_switches (
  feature     text PRIMARY KEY,
  killed      boolean NOT NULL,
  reason      text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Cost-first: toda función de pago empieza sin presupuesto y apagada hasta que el propietario la apruebe.
INSERT INTO cost.budgets (key, period, limit_usd) VALUES ('ai', 'DAILY', 0), ('sms', 'DAILY', 0), ('translation', 'DAILY', 0);
INSERT INTO cost.kill_switches (feature, killed, reason) VALUES
  ('ai', true, 'Sin presupuesto aprobado'), ('sms', true, 'Sin presupuesto aprobado'), ('translation', true, 'Sin presupuesto aprobado');
