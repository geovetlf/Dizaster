-- ADR 0187: latido de cada bucle del worker. Una fila por instancia y rol; se sobrescribe (no es auditoría).
CREATE TABLE platform.worker_heartbeats (
  instance_id text NOT NULL,
  role        text NOT NULL CHECK (role IN ('urgent','normal','maintenance')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  beat_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, role)
);
