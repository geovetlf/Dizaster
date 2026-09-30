# ADR 0244 — Ciclo de vida: respeta avisos vigentes y va en transacción

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

- El ciclo por inactividad (ADR 0059) solo miraba `last_activity_at`. Un ítem de fuente que no cambia no renueva la
  actividad, así que una tormenta con aviso oficial de 5 días pasaba a RESOLVED a las 72 h y enviaba "Terminado" a
  quienes la seguían. §10.1 pide que el ciclo dependa de la inactividad y de las fuentes oficiales.
- El worker ejecutaba el ciclo, el fin oficial y el archivo contra el pool: cada UPDATE, entrada de historial y
  evento de outbox se confirmaba por separado. Un corte a medias dejaba eventos cerrados sin su `EventLifecycleChanged`,
  y nunca se reintentaba (§6.2, outbox transaccional).

## Decisión

- `ingestion.activeItemEvents(now)`: eventos con un ítem de fuente vigente (`ends_at` futuro, sin retirar).
  `applyLifecycle` recibe esa lista y no los mueve; cuando el aviso vence o se retira, el fin oficial (ADR 0059) o
  el ciclo normal los cierran.
- Ciclo de vida, fin oficial y archivo corren cada uno en una transacción: estado, historial y outbox van juntos.

## Consecuencias

- Nadie recibe "Terminado" mientras el aviso oficial sigue vigente. Prueba en `maintenance-jobs.test.ts`.
