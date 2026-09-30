# ADR 0228 — Límite de peticiones por cuenta compartido entre réplicas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (una sentencia por petición con sesión, solo si se activa)

## Contexto

El límite general (ADR 0047) vive en la memoria de cada proceso. Con N réplicas detrás de un balanceador, una cuenta
obtiene N veces su cupo. No hay Redis ni se quiere añadir un servicio pagado en V1.

## Decisión

- `RATE_LIMIT_SHARED=true` hace que el cupo de las cuentas con sesión (general y de escrituras) se cuente en
  `platform.rate_counters`, una tabla UNLOGGED con id interno de la cuenta, minuto y dos contadores. Una sola
  sentencia `INSERT … ON CONFLICT … RETURNING` por petición; cada réplica borra las ventanas viejas una vez por minuto.
- Las peticiones sin sesión siguen limitadas en la memoria de cada réplica. Ninguna IP se guarda en la base
  (coherente con ADR 0142 y la decisión del propietario de no retener datos de red).
- Por defecto está apagado: con una sola réplica (V1) el limitador en memoria basta y no cuesta nada.

## Consecuencias

- Al escalar a varias réplicas basta una variable de entorno.
- Prueba en `shared-rate-limit.test.ts` (dos limitadores sobre la misma base comparten el cupo).
