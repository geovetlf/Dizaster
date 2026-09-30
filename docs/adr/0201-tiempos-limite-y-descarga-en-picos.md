# ADR 0201 — Tiempos límite en base de datos y HTTP, y descarga en picos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.22 (p95 < 300 ms) y §14: en un desastre el tráfico se dispara. El pool de PostgreSQL esperaba una conexión libre
sin límite, las consultas no tenían tiempo máximo y Fastify no cortaba peticiones: en un pico las peticiones se
encolaban sin fin, la memoria crecía y todo se volvía lento a la vez en lugar de fallar rápido y recuperarse.

## Decisión

- Pool del servicio (API, worker y CLI que usan el contenedor), configurable por entorno:
  `DB_POOL_MAX` 10, espera por conexión `DB_CONNECTION_TIMEOUT_MS` 5 s, `statement_timeout` 30 s, `lock_timeout`
  10 s, `idle_in_transaction_session_timeout` 60 s, `application_name=dizaster-core`. Migraciones e importación
  geográfica usan su propio pool sin límites.
- API: `requestTimeout` 30 s. Si hay más de `API_MAX_DB_WAITING` (50) peticiones esperando conexión, responde
  **503 `OVERLOADED` con `Retry-After: 5`** al instante (métrica `http.shed`); `/health*` nunca se descarta.
- Consulta cancelada por tiempo, bloqueo agotado, demasiadas conexiones o espera de pool agotada → 503 `OVERLOADED`
  (no 500). La app lo traduce y la cola de reportes lo reintenta sola (es un 5xx).

## Consecuencias

- En un pico, lo que no se puede atender sale en milisegundos y el cliente reintenta; lo que entra se atiende a
  tiempo. Un proceso largo legítimo puede subir `DB_STATEMENT_TIMEOUT_MS` en su entorno.
- Prueba: `services/core/test/overload.test.ts` (consulta cortada por PostgreSQL y descarga con pool saturado).
