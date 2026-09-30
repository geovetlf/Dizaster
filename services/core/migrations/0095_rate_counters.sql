-- Límite de peticiones compartido entre réplicas (ADR 0228). Solo cuentas con sesión: la clave es el id interno
-- de la cuenta, nunca una IP (las peticiones sin sesión se limitan en memoria de cada réplica, ADR 0142).
-- UNLOGGED: contadores de un minuto, se pueden perder en un reinicio sin daño y no pasan por el WAL.
CREATE UNLOGGED TABLE platform.rate_counters (
  user_id      uuid NOT NULL,
  win          bigint NOT NULL,
  all_count    integer NOT NULL,
  write_count  integer NOT NULL,
  PRIMARY KEY (user_id, win)
);
