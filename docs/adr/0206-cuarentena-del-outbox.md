# ADR 0206 — Cuarentena del outbox para eventos que siempre fallan

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§4.2 y §6.2 (outbox transaccional) y §5.22 (alertas operativas, ADR 0130). Un evento cuyo consumidor falla siempre
se reintentaba para siempre, con espera de hasta 1 h. Seguía contando como pendiente: la alerta "Eventos internos
pendientes" quedaba en rojo sin fin y tapaba atascos reales posteriores.

## Decisión

- Nueva columna `platform.outbox.dead_at` (migración 0090). Al fallar el intento número 15 (`OUTBOX_MAX_ATTEMPTS`,
  unas 5 h de reintentos con espera exponencial), el evento pasa a cuarentena.
- En cuarentena el evento no se reintenta y no cuenta en `backlog().pending`, en la antigüedad del más viejo ni en
  `/health/ready`. `backlog()` informa aparte de cuántos hay (`dead`).
- Alerta operativa nueva `outbox_dead` (objetivo 0) en es, en, pt y fr. Cualquier evento en cuarentena avisa por push
  a administración y operación, y avisa otra vez cuando vuelve a 0.
- CLI `pnpm outbox dead` (lista con la primera línea del error) y `pnpm outbox replay [id …]`. Este último devuelve
  los eventos a la cola con los intentos a cero. Nunca se borran: el runbook sigue prohibiendo tocarlos a mano.

## Consecuencias

- Un consumidor roto ya no deja la cola en rojo para siempre, pero su evento nunca se pierde en silencio.
- Prueba `outbox-dead-letter.test.ts`: 3 fallos, cuarentena, alerta, reprocesado.
